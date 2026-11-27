// Builds the final releases of the former public packages (ADR 0016). Each one
// only forwards to a pixiboardjs subpath, so a project that still imports an old
// name shares the single bundled core instead of installing a second copy.
// Usage: node scripts/build-legacy-shims.mjs [outDir]  -> prints tarball paths as JSON.
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, ".artifacts/legacy-shims"));
const main = JSON.parse(await readFile(join(root, "packages/pixiboardjs/package.json"), "utf8"));

export const legacyPackages = {
  "@pixi-board/core": { ".": "pixiboardjs/core" },
  "@pixi-board/capabilities": { ".": "pixiboardjs/capabilities" },
  "@pixi-board/agent-tools": { ".": "pixiboardjs/agent-tools", "./schemas": "pixiboardjs/agent-tools/schemas" },
  "@pixi-board/plugin-sdk": { ".": "pixiboardjs/plugin" },
};

await rm(outDir, { recursive: true, force: true });
const tarballs = {};
for (const [name, targets] of Object.entries(legacyPackages)) {
  const dir = join(outDir, name.replace("@pixi-board/", ""));
  await mkdir(dir, { recursive: true });
  const exports = {};
  for (const [subpath, target] of Object.entries(targets)) {
    const file = subpath === "." ? "index" : subpath.slice(2);
    await writeFile(join(dir, `${file}.js`), `export * from "${target}";\n`);
    await writeFile(join(dir, `${file}.d.ts`), `export * from "${target}";\n`);
    exports[subpath] = { types: `./${file}.d.ts`, import: `./${file}.js`, default: `./${file}.js` };
  }
  const moved = Object.entries(targets).map(([subpath, target]) => `\`${subpath === "." ? name : name + subpath.slice(1)}\` → \`${target}\``).join("\n- ");
  await writeFile(join(dir, "README.md"), `# ${name}\n\nDeprecated. This package now only forwards to \`pixiboardjs\`; import from the subpath instead:\n\n- ${moved}\n`);
  await writeFile(join(dir, "package.json"), `${JSON.stringify({
    name,
    version: main.version,
    description: `Deprecated: use ${Object.values(targets)[0]}.`,
    license: main.license,
    repository: main.repository,
    type: "module",
    sideEffects: false,
    exports: { ...exports, "./package.json": "./package.json" },
    types: "./index.d.ts",
    dependencies: { pixiboardjs: main.version },
    publishConfig: { access: "public" },
  }, null, 2)}\n`);
  const { stdout } = await run("npm", ["pack", "--json", "--pack-destination", outDir], { cwd: dir });
  const [info] = JSON.parse(stdout);
  tarballs[name] = isAbsolute(info.filename) ? info.filename : join(outDir, info.filename);
}
console.log(JSON.stringify(tarballs));
