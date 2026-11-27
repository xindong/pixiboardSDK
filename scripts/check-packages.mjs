import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workspace = JSON.parse(await readFile(resolve(root, "packages/pixiboardjs/package.json"), "utf8"));
const core = JSON.parse(await readFile(resolve(root, "packages/core/package.json"), "utf8"));
const pluginSdk = JSON.parse(await readFile(resolve(root, "packages/plugin-sdk/package.json"), "utf8"));
const capabilities = JSON.parse(await readFile(resolve(root, "packages/capabilities/package.json"), "utf8"));
const agentTools = JSON.parse(await readFile(resolve(root, "packages/agent-tools/package.json"), "utf8"));
const workspaceText = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
const fixture = JSON.parse(await readFile(resolve(root, "apps/examples-vanilla/package.json"), "utf8"));
const customNodeFixture = JSON.parse(await readFile(resolve(root, "apps/examples-custom-node/package.json"), "utf8"));
const benchmark = JSON.parse(await readFile(resolve(root, "apps/benchmark/package.json"), "utf8"));

if (!workspaceText.includes('"packages/*"') || !workspaceText.includes('"apps/*"')) {
  throw new Error("pnpm-workspace.yaml must include packages/* and apps/*");
}
if (workspace.name !== "pixiboardjs" || workspace.private !== false) throw new Error("pixiboardjs must be the public package");
for (const subpath of [".", "./browser", "./node", "./types", "./core", "./capabilities", "./agent-tools", "./agent-tools/schemas", "./plugin"]) {
  const contract = workspace.exports?.[subpath];
  if (!contract) throw new Error(`missing pixiboardjs export: ${subpath}`);
  if (!contract.types?.endsWith(".d.ts")) throw new Error(`types export must be a declaration artifact: ${subpath}`);
  for (const target of new Set([contract.import, contract.default])) {
    if (!target) throw new Error(`incomplete pixiboardjs export: ${subpath}`);
    if (!target.endsWith(".js")) throw new Error(`runtime export must point at JavaScript: ${subpath} -> ${target}`);
  }
}
if (workspace.dependencies?.["pixi.js"] === undefined) throw new Error("pixiboardjs must declare pixi.js runtime dependency");
// pixiboardjs is the only public package and bundles every workspace package
// into shared chunks, so it must not depend on any of them at runtime.
for (const [name, version] of Object.entries(workspace.dependencies ?? {})) {
  if (String(version).startsWith("workspace:") || name.startsWith("@pixi-board/")) throw new Error(`published pixiboardjs must bundle, not depend on, ${name}`);
}
if (fixture.dependencies?.pixiboardjs !== "workspace:*") throw new Error("Vanilla fixture must link the workspace package in-repo");
if (customNodeFixture.dependencies?.pixiboardjs !== "workspace:*" || !customNodeFixture.scripts?.test) {
  throw new Error("Custom-node fixture must link pixiboardjs and expose its executable contract test");
}
const pluginSdkSource = await readFile(resolve(root, "packages/plugin-sdk/src/index.ts"), "utf8");
if (!pluginSdkSource.includes("export function definePlugin") || pluginSdkSource.includes("export class PluginHost")) {
  throw new Error("plugin-sdk must export definePlugin without exporting PluginHost");
}
if (benchmark.private !== true || !benchmark.scripts?.["generate:synthetic-card"]) throw new Error("benchmark must remain private and retain deterministic fixture generation");
for (const script of ["benchmark:run", "benchmark:matrix", "benchmark:report", "benchmark:check", "test"]) {
  if (!benchmark.scripts?.[script]) throw new Error(`benchmark must expose ${script}`);
}
// Former public packages are now internal workspace packages exposed only as
// pixiboardjs subpaths (ADR 0016); publishing them again would reintroduce
// duplicate core/capability instances.
for (const pkg of [core, pluginSdk, capabilities, agentTools]) {
  if (pkg.private !== true) throw new Error(`${pkg.name} must stay private; publish it through a pixiboardjs subpath`);
}
if (!agentTools.exports?.["./schemas"]) throw new Error("agent-tools must keep the ./schemas entry point bundled as pixiboardjs/agent-tools/schemas");

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

console.log("Package check passed: workspace, public exports, fixture and executable benchmark gates are present.");
