import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workspace = JSON.parse(await readFile(resolve(root, "packages/pixiboardjs/package.json"), "utf8"));
const mcpHost = JSON.parse(await readFile(resolve(root, "packages/mcp-host/package.json"), "utf8"));
const workspaceText = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
const fixture = JSON.parse(await readFile(resolve(root, "apps/examples-vanilla/package.json"), "utf8"));
const benchmark = JSON.parse(await readFile(resolve(root, "apps/benchmark/package.json"), "utf8"));

if (!workspaceText.includes('"packages/*"') || !workspaceText.includes('"apps/*"')) {
  throw new Error("pnpm-workspace.yaml must include packages/* and apps/*");
}
if (workspace.name !== "pixiboardjs" || workspace.private !== false) throw new Error("pixiboardjs must be the public package");
for (const subpath of [".", "./browser", "./node", "./types"]) {
  const contract = workspace.exports?.[subpath];
  if (!contract) throw new Error(`missing pixiboardjs export: ${subpath}`);
  for (const target of new Set([contract.types, contract.import, contract.default])) {
    if (!target) throw new Error(`incomplete pixiboardjs export: ${subpath}`);
    await access(resolve(root, "packages/pixiboardjs", target));
  }
}
for (const [name, version] of Object.entries(workspace.dependencies ?? {})) {
  if (!version.startsWith("workspace:")) throw new Error(`local pixiboardjs dependency must use workspace protocol: ${name}`);
}
if (fixture.dependencies?.pixiboardjs !== "workspace:*") throw new Error("Vanilla fixture must link the workspace package in-repo");
if (benchmark.private !== true || !benchmark.scripts?.["generate:synthetic-card"]) throw new Error("benchmark must remain a private skeleton");
if (mcpHost.name !== "@pixi-board/mcp-host" || mcpHost.private !== true) throw new Error("mcp-host must remain an internal package");
if (JSON.stringify(mcpHost.dependencies) !== JSON.stringify({ "@pixi-board/agent-tools": "workspace:*" })) throw new Error("mcp-host runtime may depend only on agent-tools");

for (const file of [
  "apps/benchmark/src/index.mjs",
  "apps/benchmark/src/synthetic-card.mjs",
  "apps/benchmark/src/metrics.mjs",
  "apps/benchmark/src/scenarios.mjs",
  "apps/examples-vanilla/index.html",
]) await access(resolve(root, file));

console.log("Package skeleton check passed: workspace, public exports, MCP boundary, fixture and benchmark contracts are present.");
