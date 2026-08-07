import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(root, "packages/pixiboardjs");
const sourceManifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
const publicPackages = [
  { name: "pixiboardjs", dir: packageDir, artifacts: ["dist/index.js", "dist/browser.js", "dist/node.js", "dist/types.js", "dist/index.d.ts", "dist/browser.d.ts", "dist/node.d.ts", "dist/types.d.ts"] },
  { name: "@pixi-board/core", dir: resolve(root, "packages/core"), artifacts: ["dist/index.js", "dist/index.d.ts"] },
  { name: "@pixi-board/plugin-sdk", dir: resolve(root, "packages/plugin-sdk"), artifacts: ["dist/index.js", "dist/index.d.ts"] },
];
const gateDir = await mkdtemp(join(tmpdir(), "pixiboardjs-release-gate-"));

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
  const { stdout } = await run("pnpm", ["pack", "--pack-destination", gateDir, "--json"], { cwd: packageDir });
  const parsedPackInfo = JSON.parse(stdout);
  const packInfo = Array.isArray(parsedPackInfo) ? parsedPackInfo[0] : parsedPackInfo;
  const tarball = resolve(packInfo.filename);
  await run("tar", ["-xzf", tarball, "-C", gateDir]);
  const packedDir = join(gateDir, "package");
  const manifest = JSON.parse(await readFile(join(packedDir, "package.json"), "utf8"));
  const blockers = [];
  const packedFiles = new Set(packInfo.files.map((file) => file.path));
  const packedWorkspaceDependencies = Object.entries(manifest.dependencies ?? {})
    .filter(([, version]) => String(version).startsWith("workspace:"));

  for (const [name, version] of packedWorkspaceDependencies) {
    blockers.push(`packed dependency leaks workspace protocol: ${name}@${version}`);
  }
  for (const declaredFile of sourceManifest.files ?? []) {
    if (extname(declaredFile) && !packedFiles.has(declaredFile)) {
      blockers.push(`declared package file is missing from tarball: ${declaredFile}`);
    }
  }

  for (const entry of await readdir(packedDir, { recursive: true })) {
    try {
      const text = await readFile(join(packedDir, entry), "utf8");
      if (text.includes("workspace:*")) blockers.push(`packed file leaks workspace:*: ${entry}`);
    } catch (error) {
      if (error.code !== "EISDIR") throw error;
    }
  }

  for (const subpath of [".", "./browser", "./node", "./types"]) {
    const contract = manifest.exports?.[subpath];
    if (!contract?.import || !contract?.default || !contract?.types) {
      blockers.push(`incomplete packed export contract: ${subpath}`);
      continue;
    }
    for (const target of new Set([contract.import, contract.default])) {
      if (![".js", ".mjs", ".cjs"].includes(extname(target))) {
        blockers.push(`runtime export is not publishable JavaScript: ${subpath} -> ${target}`);
      }
    }
    if (extname(contract.types) !== ".ts" || !contract.types.endsWith(".d.ts")) {
      blockers.push(`types export is not a declaration artifact: ${subpath} -> ${contract.types}`);
    }
    for (const target of new Set([contract.import, contract.default, contract.types])) {
      if (!packedFiles.has(target.replace(/^\.\//, ""))) blockers.push(`packed export target is missing: ${subpath} -> ${target}`);
    }
  }

  const internalDependencies = new Set([
    "@pixi-board/adapter-browser",
    "@pixi-board/capabilities",
    "@pixi-board/renderer-pixi",
  ]);
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (internalDependencies.has(name)) blockers.push(`internal package leaked as registry dependency: ${name}@${version}`);
    if (version === "0.0.0") blockers.push(`placeholder dependency version is not publishable: ${name}@${version}`);
  }

  console.log(`Packed ${sourceManifest.name}@${sourceManifest.version}: ${packInfo.files.length} files; runtime dependencies are registry-safe.`);
  if (blockers.length > 0) {
    console.error("Release gate blocked; external install/import/Vite checks were not run:");
    for (const blocker of [...new Set(blockers)].sort()) console.error(`- ${blocker}`);
    process.exitCode = 1;
  } else {
    await verifyExternalConsumers(tarball, gateDir);
    await verifyApiReports();
    await run(process.execPath, [resolve(root, "scripts/check-api-report.mjs")], { cwd: root });
    await verifyBundleBudget();
    console.log("Release gate passed: packed manifest and external Node/Vite consumers are valid.");
  }
} finally {
  await rm(gateDir, { recursive: true, force: true });
}
}

async function verifyBundleBudget() {
  await run(process.execPath, [resolve(root, "scripts/check-bundle-budget.mjs")], { cwd: root });
}

async function verifyApiReports() {
  for (const packageName of ["@pixi-board/core", "pixiboardjs", "@pixi-board/plugin-sdk"]) {
    await run("pnpm", ["--filter", packageName, "exec", "api-extractor", "run", "--verbose"], { cwd: root });
  }
}

async function verifyExternalConsumers(tarball, gateDir) {
  const fixture = join(gateDir, "consumer");
  await mkdir(join(fixture, "src"), { recursive: true });
  const publicTarballs = { pixiboardjs: tarball };
  for (const pkg of publicPackages.slice(1)) {
    const { stdout } = await run("pnpm", ["pack", "--pack-destination", gateDir, "--json"], { cwd: pkg.dir });
    const info = JSON.parse(stdout);
    publicTarballs[pkg.name] = resolve((Array.isArray(info) ? info[0] : info).filename);
  }
  const fixtureManifest = {
    name: "pixiboardjs-release-consumer",
    private: true,
    type: "module",
    scripts: { build: "vite build" },
    dependencies: Object.fromEntries(Object.entries(publicTarballs).map(([name, file]) => [name, `file:${file}`])),
    devDependencies: { vite: "^7.0.0" },
  };
  await writeFile(join(fixture, "package.json"), `${JSON.stringify(fixtureManifest, null, 2)}\n`);
  await writeFile(join(fixture, "index.html"), '<div id="app"></div><script type="module" src="/src/main.js"></script>\n');
  await writeFile(join(fixture, "src/main.js"), [
    'import { createPixiBoard } from "pixiboardjs/browser";',
    'import { createBoardCore } from "@pixi-board/core";',
    'import { PLUGIN_API_VERSION, assertV3Manifest } from "@pixi-board/plugin-sdk";',
    'const core = createBoardCore();',
    'assertV3Manifest({ id: "consumer", name: "Consumer", version: "1.0.0", apiVersion: PLUGIN_API_VERSION, permissions: [] });',
    'document.querySelector("#app").textContent = `${typeof createPixiBoard}:${core.document.get().schemaVersion}:${PLUGIN_API_VERSION}`;',
  ].join("\n"));
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fixture });

  const imports = ["pixiboardjs", "pixiboardjs/browser", "pixiboardjs/node", "pixiboardjs/types", "@pixi-board/core", "@pixi-board/plugin-sdk"];
  const code = `for (const name of ${JSON.stringify(imports)}) await import(name); console.log('consumer node imports passed');`;
  const result = await run(process.execPath, ["--input-type=module", "-e", code], { cwd: fixture });
  process.stdout.write(result.stdout);

  for (const [packageName, pkg] of Object.entries(publicTarballs)) {
    const declarationFiles = pkg === publicTarballs.pixiboardjs ? ["dist/index.d.ts", "dist/browser.d.ts", "dist/node.d.ts", "dist/types.d.ts"] : ["dist/index.d.ts"];
    for (const declarationFile of declarationFiles) {
      const declaration = await readFile(join(fixture, "node_modules", packageName, declarationFile), "utf8");
      if (/from ["']@pixi-board\/(adapter-browser|capabilities|renderer-pixi|plugin-api-v3)/.test(declaration)) {
        throw new Error(`consumer declaration leaks a private workspace package: ${packageName}/${declarationFile}`);
      }
    }
  }

  await run("npm", ["run", "build"], { cwd: fixture });
  console.log("consumer npm run build passed: browser entry resolved and bundled");
}
