import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const workspace = JSON.parse(await readFile(resolve(root, "packages/pixiboardjs/package.json"), "utf8"));
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
const pluginSdkEntry = pluginSdk.exports?.["."];
if (!pluginSdkEntry?.import?.startsWith("./dist/") || !pluginSdkEntry.import.endsWith(".js") ||
    !pluginSdkEntry?.types?.startsWith("./dist/") || !pluginSdkEntry.types.endsWith(".d.ts")) {
  throw new Error("plugin-sdk public exports must target release JS and declaration artifacts");
}
const pluginSdkSource = await readFile(resolve(root, "packages/plugin-sdk/src/index.ts"), "utf8");
if (!pluginSdkSource.includes("export function definePlugin") || pluginSdkSource.includes("export class PluginHost")) {
  throw new Error("plugin-sdk must export definePlugin without exporting PluginHost");
}
if (benchmark.private !== true || !benchmark.scripts?.["generate:synthetic-card"]) throw new Error("benchmark must remain private and retain deterministic fixture generation");
for (const script of ["benchmark:run", "benchmark:matrix", "benchmark:report", "benchmark:check", "test"]) {
  if (!benchmark.scripts?.[script]) throw new Error(`benchmark must expose ${script}`);
}
// capabilities and agent-tools are published so a third party can drive the
// canvas from its own agent layer without taking the renderer. Their runtime
// dependencies must stay externalized: bundling capabilities into agent-tools
// would ship a second CapabilityError class and break error identity.
for (const [pkg, expectedName, expectedDependencies] of [
  [capabilities, "@pixi-board/capabilities", { "@pixi-board/core": "workspace:*" }],
  [agentTools, "@pixi-board/agent-tools", { "@pixi-board/capabilities": "workspace:*", "@pixi-board/core": "workspace:*" }],
]) {
  if (pkg.name !== expectedName || pkg.private !== false) throw new Error(`${expectedName} must be a public package`);
  if (pkg.version === "0.0.0") throw new Error(`${expectedName} needs a publishable version`);
  if (JSON.stringify(pkg.dependencies) !== JSON.stringify(expectedDependencies)) {
    throw new Error(`${expectedName} runtime dependencies must stay externalized as ${JSON.stringify(expectedDependencies)}`);
  }
  for (const [subpath, contract] of Object.entries(pkg.exports ?? {})) {
    if (subpath === "./package.json") continue;
    if (!contract?.import?.startsWith("./dist/") || !contract.import.endsWith(".js") ||
        !contract?.types?.startsWith("./dist/") || !contract.types.endsWith(".d.ts")) {
      throw new Error(`${expectedName} public export must target release artifacts: ${subpath}`);
    }
  }
}
if (!agentTools.exports?.["./schemas"]) throw new Error("agent-tools must keep the ./schemas entry point for JSON Schema consumers");

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
