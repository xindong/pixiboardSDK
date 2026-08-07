import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workspace = JSON.parse(await readFile(resolve(root, "packages/pixiboardjs/package.json"), "utf8"));
const workspaceText = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
const fixture = JSON.parse(await readFile(resolve(root, "apps/examples-vanilla/package.json"), "utf8"));
const benchmark = JSON.parse(await readFile(resolve(root, "apps/benchmark/package.json"), "utf8"));

if (!workspaceText.includes('"packages/*"') || !workspaceText.includes('"apps/*"')) {
  throw new Error("pnpm-workspace.yaml must include packages/* and apps/*");
}
if (workspace.name !== "pixiboardjs" || workspace.private !== false) throw new Error("pixiboardjs must be the public package");
for (const subpath of [".", "./browser", "./node", "./types"]) {
  if (!workspace.exports?.[subpath]) throw new Error(`missing pixiboardjs export: ${subpath}`);
}
if (JSON.stringify(workspace).includes("workspace:")) throw new Error("public package must not leak workspace protocol");
if (fixture.dependencies?.pixiboardjs !== workspace.version) throw new Error("Vanilla fixture must target the package placeholder version");
if (benchmark.private !== true || !benchmark.scripts?.["generate:synthetic-card"]) throw new Error("benchmark must remain a private skeleton");

for (const file of [
  "apps/benchmark/src/index.mjs",
  "apps/benchmark/src/synthetic-card.mjs",
  "apps/benchmark/src/metrics.mjs",
  "apps/benchmark/src/scenarios.mjs",
  "apps/examples-vanilla/index.html",
]) await access(resolve(root, file));

console.log("Package skeleton check passed: workspace, public exports, fixture and benchmark contracts are present.");
