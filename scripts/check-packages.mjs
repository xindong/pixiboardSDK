import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workspace = JSON.parse(await readFile(resolve(root, "packages/pixiboardjs/package.json"), "utf8"));
const pluginSdk = JSON.parse(await readFile(resolve(root, "packages/plugin-sdk/package.json"), "utf8"));
const mcpHost = JSON.parse(await readFile(resolve(root, "packages/mcp-host/package.json"), "utf8"));
const workspaceText = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
const fixture = JSON.parse(await readFile(resolve(root, "apps/examples-vanilla/package.json"), "utf8"));
const customNodeFixture = JSON.parse(await readFile(resolve(root, "apps/examples-custom-node/package.json"), "utf8"));
const benchmark = JSON.parse(await readFile(resolve(root, "apps/benchmark/package.json"), "utf8"));

if (!workspaceText.includes('"packages/*"') || !workspaceText.includes('"apps/*"')) {
  throw new Error("pnpm-workspace.yaml must include packages/* and apps/*");
}
if (workspace.name !== "pixiboardjs" || workspace.private !== false) throw new Error("pixiboardjs must be the public package");
for (const subpath of [".", "./browser", "./node", "./types"]) {
  const contract = workspace.exports?.[subpath];
  if (!contract) throw new Error(`missing pixiboardjs export: ${subpath}`);
  if (!contract.types?.endsWith(".d.ts")) throw new Error(`types export must be a declaration artifact: ${subpath}`);
  for (const target of new Set([contract.import, contract.default])) {
    if (!target) throw new Error(`incomplete pixiboardjs export: ${subpath}`);
    if (!target.endsWith(".js")) throw new Error(`runtime export must point at JavaScript: ${subpath} -> ${target}`);
  }
}
if (workspace.dependencies?.["pixi.js"] === undefined) throw new Error("pixiboardjs must declare pixi.js runtime dependency");
for (const [name, version] of Object.entries(workspace.dependencies ?? {})) {
  if (String(version).startsWith("workspace:")) throw new Error(`published pixiboardjs dependency must not use workspace protocol: ${name}`);
}
if (fixture.dependencies?.pixiboardjs !== "workspace:*") throw new Error("Vanilla fixture must link the workspace package in-repo");
if (customNodeFixture.dependencies?.pixiboardjs !== "workspace:*" || !customNodeFixture.scripts?.test) {
  throw new Error("Custom-node fixture must link pixiboardjs and expose its executable contract test");
}
if (pluginSdk.name !== "@pixi-board/plugin-sdk" || pluginSdk.private !== false) {
  throw new Error("plugin-sdk must be a public package");
}
await access(resolve(root, "packages/plugin-sdk", pluginSdk.exports["."].import));
const pluginSdkSource = await readFile(resolve(root, "packages/plugin-sdk/src/index.ts"), "utf8");
if (!pluginSdkSource.includes("export function definePlugin") || pluginSdkSource.includes("export class PluginHost")) {
  throw new Error("plugin-sdk must export definePlugin without exporting PluginHost");
}
if (benchmark.private !== true || !benchmark.scripts?.["generate:synthetic-card"]) throw new Error("benchmark must remain private and retain deterministic fixture generation");
for (const script of ["benchmark:run", "benchmark:matrix", "benchmark:report", "benchmark:check", "test"]) {
  if (!benchmark.scripts?.[script]) throw new Error(`benchmark must expose ${script}`);
}
if (mcpHost.name !== "@pixi-board/mcp-host" || mcpHost.private !== true) throw new Error("mcp-host must remain an internal package");
if (JSON.stringify(mcpHost.dependencies) !== JSON.stringify({ "@pixi-board/agent-tools": "workspace:*" })) throw new Error("mcp-host runtime may depend only on agent-tools");

for (const file of [
  "apps/benchmark/src/index.mjs",
  "apps/benchmark/src/synthetic-card.mjs",
  "apps/benchmark/src/metrics.mjs",
  "apps/benchmark/src/scenarios.mjs",
  "apps/benchmark/src/harness.ts",
  "apps/benchmark/src/adapter.ts",
  "apps/benchmark/src/sdk-adapter.mjs",
  "apps/benchmark/src/run.ts",
  "apps/benchmark/src/check-regression.mjs",
  "apps/benchmark/test/benchmark-run.test.ts",
  "apps/benchmark/test/adapter-runner.test.ts",
  "apps/benchmark/test/benchmark-matrix.test.ts",
  "apps/benchmark/test/sdk-adapter.test.ts",
  "apps/benchmark/test/sdk-report.test.ts",
  "apps/benchmark/test/regression.test.ts",
  "apps/examples-vanilla/index.html",
  "apps/examples-custom-node/src/fixture.ts",
  "apps/examples-custom-node/test/custom-node.test.ts",
]) await access(resolve(root, file));

console.log("Package check passed: workspace, public exports, MCP boundary, fixture and executable benchmark gates are present.");
