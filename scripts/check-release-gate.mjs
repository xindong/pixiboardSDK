import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(root, "packages/pixiboardjs");
const sourceManifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
const gateDir = await mkdtemp(join(tmpdir(), "pixiboardjs-release-gate-"));

await main();

async function main() {
try {
  const artifactBlockers = [];
  for (const target of ["dist/index.js", "dist/browser.js", "dist/node.js", "dist/types.js", "dist/index.d.ts", "dist/browser.d.ts", "dist/node.d.ts", "dist/types.d.ts"]) {
    try { await readFile(join(packageDir, target)); } catch (error) {
      if (error.code === "ENOENT") artifactBlockers.push(`missing release artifact: ${target}`);
      else throw error;
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

async function verifyExternalConsumers(tarball, gateDir) {
  const fixture = join(gateDir, "consumer");
  await cp(resolve(root, "apps/examples-vanilla"), fixture, { recursive: true });
  const fixtureManifest = JSON.parse(await readFile(join(fixture, "package.json"), "utf8"));
  fixtureManifest.dependencies = { pixiboardjs: `file:${tarball}` };
  fixtureManifest.devDependencies = Object.fromEntries(
    Object.entries(fixtureManifest.devDependencies ?? {}).filter(([, version]) => !String(version).startsWith("workspace:")),
  );
  await writeFile(join(fixture, "package.json"), `${JSON.stringify(fixtureManifest, null, 2)}\n`);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fixture });

  const imports = ["pixiboardjs", "pixiboardjs/browser", "pixiboardjs/node", "pixiboardjs/types"];
  const code = `for (const name of ${JSON.stringify(imports)}) await import(name); console.log('consumer node imports passed');`;
  const result = await run(process.execPath, ["--input-type=module", "-e", code], { cwd: fixture });
  process.stdout.write(result.stdout);

  const port = 41_000 + (process.pid % 1_000);
  const vite = spawn(join(fixture, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: fixture, stdio: "ignore" });
  try {
    const deadline = Date.now() + 15_000;
    let response;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/src/main.js`);
        if (response.ok) break;
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    if (!response?.ok) throw new Error("Vite consumer did not become ready");
    const transformed = await response.text();
    if (!transformed.includes("pixiboardjs") && !transformed.includes("/node_modules/.vite/")) {
      throw new Error("Vite consumer did not transform the pixiboardjs import");
    }
    console.log(`consumer vite smoke passed (${response.status})`);
  } finally {
    vite.kill("SIGTERM");
  }
}
