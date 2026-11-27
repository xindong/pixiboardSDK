import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// pixiboardjs is the only public package (ADR 0016): core, capabilities,
// agent-tools and plugin ship as its subpaths from one shared bundle.
const entries = ["browser", "node", "types", "core", "capabilities", "agent-tools", "agent-tools-schemas", "plugin"];
const publicPackages = [
  { name: "pixiboardjs", dir: resolve(root, "packages/pixiboardjs"), artifacts: ["index", ...entries].flatMap((entry) => [`dist/${entry}.js`, `dist/${entry}.d.ts`]) },
];
const internalDependencies = new Set([
  "@pixi-board/adapter-browser", "@pixi-board/renderer-pixi", "@pixi-board/plugin-api-v3",
  "@pixi-board/core", "@pixi-board/capabilities", "@pixi-board/agent-tools", "@pixi-board/plugin-sdk",
]);
// One report per published entry point: API Extractor only walks the single
// entry it is pointed at, so every subpath needs its own config and report.
const apiReports = [
  ["pixiboardjs", resolve(root, "packages/pixiboardjs/etc/pixiboardjs.api.md")],
  ...entries.map((entry) => [`pixiboardjs-${entry}`, resolve(root, `packages/pixiboardjs/etc/pixiboardjs-${entry}.api.md`)]),
];
const apiExtractorRuns = [
  ["pixiboardjs", []],
  ...entries.map((entry) => ["pixiboardjs", ["--config", `api-extractor.${entry}.json`]]),
];
const gateDir = await mkdtemp(join(tmpdir(), "pixiboardjs-release-gate-"));
const releaseArtifactDir = process.env.PIXIBOARD_RELEASE_ARTIFACT_DIR ? resolve(root, process.env.PIXIBOARD_RELEASE_ARTIFACT_DIR) : undefined;

await main();

async function main() {
  try {
    const artifactBlockers = [];
    for (const pkg of publicPackages) {
      for (const target of pkg.artifacts) {
        try { await readFile(join(pkg.dir, target)); } catch (error) {
          if (error.code === "ENOENT") artifactBlockers.push(`${pkg.name}: missing release artifact: ${target}`);
          else throw error;
        }
      }
    }
    if (artifactBlockers.length) {
      console.error("Release gate blocked before pack; generate real artifacts with pnpm build:release:");
      for (const blocker of artifactBlockers) console.error(`- ${blocker}`);
      process.exitCode = 1;
      return;
    }

    const packedPackages = [];
    for (const pkg of publicPackages) packedPackages.push(await packPublicPackage(pkg));
    const blockers = [];
    for (const packed of packedPackages) {
      blockers.push(...await validatePackedPackage(packed));
      console.log(`Packed ${packed.manifest.name}@${packed.manifest.version}: ${packed.packInfo.files.length} files.`);
    }

    if (blockers.length) {
      console.error("Release gate blocked; external install/import/TypeScript/Vite checks were not run:");
      for (const blocker of [...new Set(blockers)].sort()) console.error(`- ${blocker}`);
      process.exitCode = 1;
      return;
    }

    const publicTarballs = Object.fromEntries(packedPackages.map(({ pkg, tarball }) => [pkg.name, tarball]));
    await verifyExternalConsumers(publicTarballs);
    await verifyApiReports();
    await runAndPrint(process.execPath, [resolve(root, "scripts/check-api-report.mjs")], { cwd: root });
    await persistApiReports();
    await runAndPrint(process.execPath, [resolve(root, "scripts/check-bundle-budget.mjs")], { cwd: root });
    await persistReleaseManifest(publicTarballs);
    console.log("Release gate passed: all public packed manifests and external Node/TypeScript/Vite consumers are valid.");
  } finally {
    await rm(gateDir, { recursive: true, force: true });
  }
}

async function packPublicPackage(pkg) {
  const { stdout } = await run("pnpm", ["pack", "--pack-destination", gateDir, "--json"], { cwd: pkg.dir });
  const parsed = JSON.parse(stdout);
  const packInfo = Array.isArray(parsed) ? parsed[0] : parsed;
  const tarball = isAbsolute(packInfo.filename) ? packInfo.filename : resolve(pkg.dir, packInfo.filename);
  const unpackedRoot = join(gateDir, "unpacked", pkg.name.replaceAll("/", "-").replaceAll("@", ""));
  await mkdir(unpackedRoot, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", unpackedRoot]);
  const packedDir = join(unpackedRoot, "package");
  const manifest = JSON.parse(await readFile(join(packedDir, "package.json"), "utf8"));
  if (releaseArtifactDir) {
    const destination = join(releaseArtifactDir, "tarballs", basename(tarball));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(tarball, destination);
  }
  return { pkg, packInfo, tarball, packedDir, manifest, packedFiles: new Set(packInfo.files.map((file) => file.path)) };
}

async function validatePackedPackage({ pkg, packedDir, manifest, packedFiles }) {
  const blockers = [];
  const sourceManifest = JSON.parse(await readFile(join(pkg.dir, "package.json"), "utf8"));
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (String(version).startsWith("workspace:")) blockers.push(`${pkg.name}: packed dependency leaks workspace protocol: ${name}@${version}`);
    if (internalDependencies.has(name)) blockers.push(`${pkg.name}: internal package leaked as registry dependency: ${name}@${version}`);
    if (version === "0.0.0") blockers.push(`${pkg.name}: placeholder dependency version is not publishable: ${name}@${version}`);
  }
  for (const declaredFile of sourceManifest.files ?? []) {
    if (extname(declaredFile) && !packedFiles.has(declaredFile)) blockers.push(`${pkg.name}: declared package file is missing from tarball: ${declaredFile}`);
  }
  for (const entry of await readdir(packedDir, { recursive: true })) {
    try {
      if ((await readFile(join(packedDir, entry), "utf8")).includes("workspace:*")) blockers.push(`${pkg.name}: packed file leaks workspace:*: ${entry}`);
    } catch (error) {
      if (error.code !== "EISDIR") throw error;
    }
  }
  for (const [subpath, contract] of Object.entries(manifest.exports ?? {})) {
    if (typeof contract === "string") continue;
    if (!contract?.import || !contract?.default || !contract?.types) {
      blockers.push(`${pkg.name}: incomplete packed export contract: ${subpath}`);
      continue;
    }
    for (const target of new Set([contract.import, contract.default])) {
      if (![".js", ".mjs", ".cjs"].includes(extname(target))) blockers.push(`${pkg.name}: runtime export is not publishable JavaScript: ${subpath} -> ${target}`);
    }
    if (!contract.types.endsWith(".d.ts")) blockers.push(`${pkg.name}: types export is not a declaration artifact: ${subpath} -> ${contract.types}`);
    for (const target of new Set([contract.import, contract.default, contract.types])) {
      if (!packedFiles.has(target.replace(/^\.\//, ""))) blockers.push(`${pkg.name}: packed export target is missing: ${subpath} -> ${target}`);
    }
  }
  return blockers;
}

async function verifyApiReports() {
  for (const [packageName, extraArgs] of apiExtractorRuns) {
    await runAndPrint("pnpm", ["--filter", packageName, "exec", "api-extractor", "run", "--verbose", ...extraArgs], { cwd: root });
  }
}

async function persistApiReports() {
  if (!releaseArtifactDir) return;
  const destinationDir = join(releaseArtifactDir, "api-reports");
  await mkdir(destinationDir, { recursive: true });
  for (const [, source] of apiReports) await copyFile(source, join(destinationDir, basename(source)));
}

async function persistReleaseManifest(publicTarballs) {
  if (!releaseArtifactDir) return;
  await mkdir(releaseArtifactDir, { recursive: true });
  const bundleReport = process.env.PIXIBOARD_BUNDLE_REPORT ? resolve(root, process.env.PIXIBOARD_BUNDLE_REPORT) : undefined;
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    passed: true,
    packages: Object.entries(publicTarballs).map(([name, tarball]) => ({ name, tarball: `tarballs/${basename(tarball)}` })),
    apiReports: apiReports.map(([name, report]) => ({ name, report: `api-reports/${basename(report)}` })),
    bundleReport: bundleReport ? relative(releaseArtifactDir, bundleReport) : null,
    externalConsumers: ["node-imports", "typescript-compile", "vite-production-build"],
  };
  await writeFile(join(releaseArtifactDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function verifyExternalConsumers(publicTarballs) {
  const fixture = join(gateDir, "consumer");
  await mkdir(join(fixture, "src"), { recursive: true });
  // Final forwarding releases of the former public packages (ADR 0016).
  const { stdout: legacyOutput } = await run(process.execPath, [resolve(root, "scripts/build-legacy-shims.mjs"), join(gateDir, "legacy")], { cwd: root });
  const legacyTarballs = JSON.parse(legacyOutput.trim().split("\n").at(-1));
  if (releaseArtifactDir) {
    for (const tarball of Object.values(legacyTarballs)) {
      await mkdir(join(releaseArtifactDir, "legacy-shims"), { recursive: true });
      await copyFile(tarball, join(releaseArtifactDir, "legacy-shims", basename(tarball)));
    }
  }
  const fixtureManifest = {
    name: "pixiboardjs-release-consumer",
    private: true,
    type: "module",
    scripts: { build: "vite build", check: "tsc --noEmit" },
    dependencies: Object.fromEntries(Object.entries({ ...publicTarballs, ...legacyTarballs }).map(([name, file]) => [name, `file:${file}`])),
    devDependencies: { typescript: "5.9.3", vite: "^7.0.0" },
  };
  await writeFile(join(fixture, "package.json"), `${JSON.stringify(fixtureManifest, null, 2)}\n`);
  await writeFile(join(fixture, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, lib: ["ES2022", "DOM"] }, include: ["src/main.ts"] }, null, 2)}\n`);
  await writeFile(join(fixture, "index.html"), '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n');
  await writeFile(join(fixture, "src/main.ts"), [
    'import { createPixiBoard } from "pixiboardjs/browser";',
    'import { createBoardCore } from "pixiboardjs/core";',
    'import { createBoardCapabilities } from "pixiboardjs/capabilities";',
    'import { createPixiBoardAgentTools } from "pixiboardjs/agent-tools";',
    'import { canvasReadSchema } from "pixiboardjs/agent-tools/schemas";',
    'import { PLUGIN_API_VERSION, assertV3Manifest } from "pixiboardjs/plugin";',
    'const core = createBoardCore();',
    // A core from one subpath must type-check where another subpath expects it.
    'const capabilities = createBoardCapabilities(core);',
    'void capabilities; void createPixiBoardAgentTools; void canvasReadSchema;',
    'assertV3Manifest({ id: "consumer", name: "Consumer", version: "1.0.0", apiVersion: PLUGIN_API_VERSION, permissions: [] });',
    'document.querySelector("#app")!.textContent = `${typeof createPixiBoard}:${core.document.snapshot().schemaVersion}:${PLUGIN_API_VERSION}`;',
  ].join("\n"));
  await runAndPrint("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fixture });
  const imports = ["pixiboardjs", "pixiboardjs/browser", "pixiboardjs/node", "pixiboardjs/types", "pixiboardjs/core", "pixiboardjs/capabilities", "pixiboardjs/agent-tools", "pixiboardjs/agent-tools/schemas", "pixiboardjs/plugin"];
  await runAndPrint(process.execPath, ["--input-type=module", "-e", `for (const name of ${JSON.stringify(imports)}) await import(name); console.log('consumer node imports passed');`], { cwd: fixture });
  // Every entry must re-export the one bundled core and capabilities.
  await runAndPrint(process.execPath, ["--input-type=module", "-e", [
    'const core = await import("pixiboardjs/core");',
    'const capabilities = await import("pixiboardjs/capabilities");',
    'for (const name of ["pixiboardjs", "pixiboardjs/node"]) {',
    '  const entry = await import(name);',
    '  if (entry.DocumentValidationError !== core.DocumentValidationError) throw new Error(`${name} does not share pixiboardjs/core`);',
    '  if (entry.CapabilityError !== capabilities.CapabilityError) throw new Error(`${name} does not share pixiboardjs/capabilities`);',
    '}',
    // Old package names forward to the same bundled instances.
    'if ((await import("@pixi-board/core")).DocumentValidationError !== core.DocumentValidationError) throw new Error("@pixi-board/core shim does not forward to pixiboardjs/core");',
    'if ((await import("@pixi-board/capabilities")).CapabilityError !== capabilities.CapabilityError) throw new Error("@pixi-board/capabilities shim does not forward to pixiboardjs/capabilities");',
    'if ((await import("@pixi-board/agent-tools/schemas")).canvasReadSchema !== (await import("pixiboardjs/agent-tools/schemas")).canvasReadSchema) throw new Error("@pixi-board/agent-tools shim does not forward");',
    'if ((await import("@pixi-board/plugin-sdk")).assertV3Manifest !== (await import("pixiboardjs/plugin")).assertV3Manifest) throw new Error("@pixi-board/plugin-sdk shim does not forward");',
    'console.log("consumer core identity passed (including legacy package names)");',
  ].join("\n")], { cwd: fixture });
  for (const [packageName, tarball] of Object.entries(publicTarballs)) {
    const declarationFiles = (await readdir(join(fixture, "node_modules", packageName, "dist"))).filter((file) => file.endsWith(".d.ts")).map((file) => `dist/${file}`);
    for (const declarationFile of declarationFiles) {
      const declaration = await readFile(join(fixture, "node_modules", packageName, declarationFile), "utf8");
      if (/from ["']@pixi-board\//.test(declaration)) throw new Error(`consumer declaration leaks a private workspace package: ${packageName}/${declarationFile} (${basename(tarball)})`);
    }
  }
  await runAndPrint("npm", ["run", "check"], { cwd: fixture });
  console.log("consumer npm run check passed: external TypeScript declarations compile");
  await runAndPrint("npm", ["run", "build"], { cwd: fixture });
  console.log("consumer npm run build passed: browser entry resolved and bundled");
}

async function runAndPrint(command, args, options) {
  const result = await run(command, args, options);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}
