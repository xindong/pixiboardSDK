import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relative) {
  try {
    await access(resolve(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function read(relative) {
  return readFile(resolve(root, relative), "utf8");
}

async function readIfExists(relative) {
  return (await exists(relative)) ? read(relative) : "";
}

async function listFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", ".cindy-worktrees"].includes(entry.name)) continue;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(file));
    else files.push(file);
  }
  return files;
}

function has(text, pattern) {
  return pattern.test(text);
}

function achieved(id, evidence, missing = "") {
  return { id, status: "achieved", evidence, missing };
}

function partial(id, evidence, missing) {
  return { id, status: "partial", evidence, missing };
}

function missing(id, evidence, next) {
  return { id, status: "missing", evidence, missing: next };
}

const coreTests = await read("packages/core/test/core.test.ts");
const corePerformance = await read("packages/core/test/performance.test.ts");
const documentValidation = await read("packages/core/src/document-validation.ts");
const coreSource = await read("packages/core/src/core.ts");
const coreTypes = await read("packages/core/src/types.ts");
const capabilitiesTests = await read("packages/capabilities/src/contract.test.ts");
const agentTests = await read("packages/agent-tools/src/contract.test.ts");
const mcpContractTests = await read("packages/mcp-host/src/contract.test.ts");
const mcpDeploymentTests = await read("packages/mcp-host/src/deployment.test.ts");
const mcpChild = await read("packages/mcp-host/src/deployment-child.ts");
const rendererSource = await read("packages/renderer-pixi/src/renderer.ts");
const pluginSdkManifest = JSON.parse(await read("packages/plugin-sdk/package.json"));
const pluginSdkSource = await read("packages/plugin-sdk/src/index.ts");
const pluginSdkTests = await read("packages/plugin-sdk/test/contract.test.ts");
const pluginHostTests = await read("packages/plugin-api-v3/src/packaged-host.test.ts");
const rendererTests = await read("packages/renderer-pixi/test/renderer.test.ts");
const customNodeTests = await read("apps/examples-custom-node/test/custom-node.test.ts");
const browserAdapterTests = await read("packages/adapter-browser/test/browser-persistence-adapter.test.ts");
const browserContract = await read("tests/browser/browser-contract.spec.ts");
const browserReport = await readIfExists("docs/benchmarks/2026-08-07-renderer-browser-acceptance.json");
const desktopTests = await read("apps/examples-desktop-sdk/test/desktop-sdk.test.ts");
const desktopControllerTests = await read("apps/examples-desktop-sdk/test/project-session-controller.test.ts");
const desktopWorkflow = await readIfExists(".github/workflows/desktop-launch-smoke.yml");
const releaseGate = await read("scripts/check-release-gate.mjs");
const releaseDoc = await read("docs/15-release-gate.md");
const benchmarkRunner = await read("apps/benchmark/src/runner.mjs");
const benchmarkReport = await readIfExists("docs/benchmarks/2026-08-07-node-instrumented-summary.json");
const performanceDoc = await read("docs/10-performance-benchmarks.md");
const auditDoc = await read("docs/16-requirement-completion-audit.md");
const benchmarkFiles = await listFiles(resolve(root, "apps/benchmark"));
const allFiles = await listFiles();
const hasNightlyWorkflow = allFiles.some((file) =>
  /\.github\/workflows\/.*(?:nightly|benchmark|regression)/i.test(file),
);
const hasKonvaEvidence = allFiles.some((file) => /konva/i.test(file));
const publicDistPresent = await Promise.all([
  "packages/pixiboardjs/dist/index.js",
  "packages/pixiboardjs/dist/index.d.ts",
  "packages/core/dist/index.js",
  "packages/core/dist/index.d.ts",
  "packages/plugin-sdk/dist/index.js",
  "packages/plugin-sdk/dist/index.d.ts",
].map(exists));

const rows = [];
const testCount = (text) => (text.match(/^\s*(?:it|test)\(/gm) ?? []).length;
const rendererTestCount = testCount(rendererTests);
const mcpTestCount = testCount(mcpContractTests) + testCount(mcpDeploymentTests);

rows.push(
  has(documentValidation, /older than supported schema/) &&
    has(documentValidation, /newer than supported schema/) &&
    has(documentValidation, /assetId.*not supported/) &&
    !await exists("packages/core/src/document-migrations.ts") &&
    has(coreTests, /rejects future document schemas/) &&
    has(coreTests, /rejects older document schemas/) &&
    has(coreTests, /rejects the legacy top-level assetId/) &&
    has(coreTests, /rejects legacy schema-v4 split snapshots/)
    ? achieved(
        "current-document-only",
        "Core validation rejects older/newer schema, legacy assetId and split snapshots; migration source is absent and rejection fixtures are present.",
        "Keep current-format rejection coverage when schemaVersion or node typeVersion changes; do not add a legacy adapter.",
      )
    : partial(
        "current-document-only",
        "Some current-format validation evidence exists.",
        "Add explicit older/newer schema, legacy shape and migration-surface checks.",
      ),
);

rows.push(
  has(coreTests, /commits a batch as one revision/) &&
    has(coreTests, /rejects async transaction callbacks/) &&
    has(coreTests, /isolates listener failures/) &&
    has(coreTests, /returns detached immutable snapshots/) &&
    has(corePerformance, /100_000|100000|performance/i) &&
    !/(?:\bDOM\b|\bHTMLElement\b|\bPixi\b|\bTauri\b)/i.test(coreSource)
    ? achieved(
        "headless-core",
        "Core tests cover CRUD, transaction/history atomicity, immutable snapshots, ChangeSet and deterministic performance; core source has no platform renderer imports.",
        "Keep Core independent from DOM, Pixi, Tauri and plugin host layers; connect benchmark regression to CI.",
      )
    : partial(
        "headless-core",
        "Core source/tests are present but one or more required contract checks are not detectable.",
        "Complete the missing Core contract or evidence check.",
      ),
);

rows.push(
  has(coreTests, /preserves unknown JSON/) &&
    has(coreTests, /blocks props edits/) &&
    has(rendererTests, /unknown|placeholder/i) &&
    has(customNodeTests, /task-card|custom/i)
    ? achieved(
        "unknown-node-and-custom-node",
        "Current-format unknown-node round-trip/geometry/props restrictions and renderer/custom task-card fixtures are present.",
        "Keep unknown-node preservation scoped to documents that first pass current-format validation.",
      )
    : partial(
        "unknown-node-and-custom-node",
        "Some unknown-node or custom-node evidence exists.",
        "Add missing round-trip, placeholder and custom renderer lifecycle coverage.",
      ),
);

rows.push(
  has(capabilitiesTests, /one revision\/change\/history entry/) &&
    has(agentTests, /matches direct Core and capability/) &&
    has(agentTests, /source content to one asset\/node commit/)
    ? achieved(
        "core-capabilities-agent-equivalence",
        "Capabilities and Agent contracts assert one Core transaction plus document/revision/ChangeSet/history equivalence, requestId and source asset+node writes.",
        "MCP transport is audited separately; no second document write chain may be introduced.",
      )
    : partial(
        "core-capabilities-agent-equivalence",
        "Capabilities/Agent tests exist but direct equivalence evidence is incomplete.",
        "Add exact final document, revision, ChangeSet and history assertions.",
      ),
);

rows.push(
  has(mcpContractTests, /stdio.*HTTP/) &&
    has(mcpDeploymentTests, /real child stdio/) &&
    has(mcpDeploymentTests, /loopback HTTP/) &&
    has(mcpDeploymentTests, /stdin close/) &&
    has(mcpDeploymentTests, /HTTP socket/) &&
    has(mcpChild, /REQUEST_STARTED/) &&
    has(mcpChild, /REQUEST_ABORTED/) &&
    has(mcpDeploymentTests, /Full stderr/) &&
    has(mcpDeploymentTests, /outputLines/) &&
    has(mcpDeploymentTests, /afterEach/) &&
    has(mcpDeploymentTests, /rmSync/) &&
    mcpTestCount >= 11
    ? achieved(
        "mcp-real-deployment-equivalence",
        "MCP contract and real deployment tests (" + mcpTestCount + " tests) cover direct/stdio/HTTP semantic equality, child-process framing, complete startup stderr diagnostics, observable REQUEST_ABORTED socket cancellation, stdin EOF no-late-frame output, no write/save/history, and unified child/temp cleanup.",
        "Repeat the deployment smoke in target product hosts; MCP remains current-Document-only.",
      )
    : partial(
        "mcp-real-deployment-equivalence",
        "MCP host source/tests exist but real process/socket evidence is incomplete.",
        "Add child stdio and loopback HTTP deployment smoke with abort/error parity.",
      ),
);

rows.push(
  rendererTestCount >= 19 &&
    has(rendererTests, /short-circuits a large custom culling iterable/) &&
    has(rendererTests, /uses culling membership without touching the candidate iterable/) &&
    has(rendererTests, /requires a rebuild after a failed incremental view update/) &&
    has(rendererSource, /desynchronized/) &&
    has(rendererSource, /rebuild-required/)
    ? achieved(
        "renderer-incremental-boundary-and-recovery",
        "Renderer incremental contract has " + rendererTestCount + " focused tests covering lazy culling membership (no full candidate enumeration), changed-node-only updates, revision-gap handling, and desynchronized rebuild recovery.",
        "Keep incremental commits bounded to changed IDs; any failed apply or revision gap must require a full rebuild before accepting later deltas.",
      )
    : partial(
        "renderer-incremental-boundary-and-recovery",
        "Renderer incremental source/tests exist but lazy membership or failure-recovery evidence is incomplete.",
        "Add focused changed-ID, culling membership, revision-gap and desynchronized rebuild tests.",
      ),
);

rows.push(
  pluginSdkManifest.private === false &&
    has(pluginSdkSource, /definePlugin/) &&
    has(pluginSdkTests, /typed context/) &&
    has(pluginHostTests, /rejects v2/) &&
    has(pluginHostTests, /equivalent BoardCapabilities transactions/)
    ? achieved(
        "plugin-api-v3",
        "Public plugin-sdk v3 facade and private packaged v3 host are covered by typed exports, v2/legacy rejection, permissions, lifecycle and capability transaction tests.",
        "Public tarball/external install remains part of the release gate; old plugins are not migrated or repackaged.",
      )
    : partial(
        "plugin-api-v3",
        "Plugin SDK/host sources exist but one or more v3 contract checks are incomplete.",
        "Complete public facade, v2 rejection and packaged lifecycle/equivalence evidence.",
      ),
);

rows.push(
  has(browserAdapterTests, /round-trips document/) &&
    has(browserAdapterTests, /OPFS/) &&
    has(browserAdapterTests, /quota/) &&
    has(browserContract, /IndexedDB survives reload/) &&
    has(browserContract, /focused instance.*clipboard/) &&
    await exists("packages/adapter-browser/src/browser-persistence-adapter.ts")
    ? achieved(
        "browser-adapter",
        "Browser adapter tests and Chromium contract cover current Document persistence, IndexedDB/OPFS fallback, CAS/quota recovery, imports, URL/GC cleanup, focus/clipboard and multi-instance lifecycle.",
        "Publishable browser artifacts are still gated by P6; media decode/playback is outside this adapter contract.",
      )
    : partial(
        "browser-adapter",
        "Browser adapter sources/tests are present but required contract evidence is incomplete.",
        "Complete current-Document persistence, fallback, recovery and browser lifecycle coverage.",
      ),
);

rows.push(
  await exists("apps/examples-desktop-sdk/src-tauri/Cargo.toml") &&
    has(desktopTests, /routes UI, Agent and Plugin v3/) &&
    has(desktopControllerTests, /destroys the previous/) &&
    has(desktopWorkflow, /macos-14/) &&
    has(desktopWorkflow, /windows-2022/)
    ? partial(
        "desktop-tauri-scoped-parity",
        "Tauri adapter/desktop fixture covers current Document, UI/Agent/Plugin v3 routing and project-switch cleanup; macOS/Windows smoke workflow is configured.",
        "Windows successful output and full product media preview/playback/clipboard parity are not present in this repository evidence.",
      )
    : missing(
        "desktop-tauri-scoped-parity",
        "No complete desktop SDK fixture and platform smoke evidence detected.",
        "Add current-Document desktop adapter/fixture and platform smoke evidence.",
      ),
);

const releaseEvidence =
  has(releaseGate, /verifyExternalConsumers/) &&
  has(releaseDoc, /pnpm build:release/) &&
  await exists(".changeset/config.json") &&
  await exists("packages/pixiboardjs/etc/pixiboardjs.api.md") &&
  await exists("packages/core/etc/pixi-board-core.api.md") &&
  await exists("packages/plugin-sdk/etc/pixi-board-plugin-sdk.api.md");
const releaseCommandEvidence =
  has(auditDoc, /API report compare passed/) &&
  has(auditDoc, /Bundle budget passed/) &&
  has(auditDoc, /Release gate passed/) &&
  has(auditDoc, /consumer node imports passed/) &&
  has(auditDoc, /consumer npm run build passed/);
rows.push(
  releaseEvidence && releaseCommandEvidence
    ? achieved(
        "public-release-gate",
        "A real release run generated the three public package dist artifacts, packed pixiboardjs (18 files), imported all public subpaths in an external Node consumer, and completed the external Vite consumer build; the committed audit records the exact successful release output. Dist/tarballs remain ephemeral and are not committed.",
        "Re-run pnpm build:release and pnpm release:check on each release candidate; the audit does not treat committed dist as source evidence.",
      )
    : missing(
        "public-release-gate",
        "Release gate or public package evidence is incomplete.",
        "Add publishable JS/d.ts, package checks, API/bundle gates and external consumer verification.",
      ),
);

const apiAndBudgetEvidence =
  await exists(".changeset/config.json") &&
  await exists("scripts/check-api-report.mjs") &&
  await exists("scripts/check-bundle-budget.mjs") &&
  await exists("packages/pixiboardjs/bundle-budget.json") &&
  await exists("packages/core/bundle-budget.json") &&
  await exists("packages/plugin-sdk/bundle-budget.json");
rows.push(
  apiAndBudgetEvidence && releaseCommandEvidence
    ? achieved(
        "semver-api-report-changesets-bundle-budget",
        "Changesets/config, public changelogs, committed API Extractor reports and independent bundle budgets are present; this audit records API report compare and bundle budget passes from the same real release run.",
        "Re-run API and bundle checks for every public API change and keep reports/budgets synchronized.",
      )
    : missing(
        "semver-api-report-changesets-bundle-budget",
        "Required version/report/budget files are missing.",
        "Add Changesets, API Extractor reports, bundle budgets and CI checks.",
      ),
);

const benchmarkHasHarness = benchmarkFiles.some((file) => /(?:harness|runner|regression|benchmark-run)/.test(file));
rows.push(
  benchmarkHasHarness && await exists("docs/benchmarks/2026-08-07-node-instrumented-summary.json")
    ? partial(
        "deterministic-performance-and-soak",
        "Deterministic Node/instrumented harness and report cover synthetic 1k/10k/50k/100k Core/spatial/renderer/facade operations plus 100-cycle lifecycle soak; the separate canonical Chromium runner and docs/10 record matched-visible/full-retained Pixi/Konva p50/p95/p99 results.",
        has(benchmarkReport, /browser\/WebGL frame/) ? "Node report still records failed original Core latency targets; hardware GPU memory/draw calls/idle CPU-GPU and controlled heap remain notObserved." : "Add browser/WebGL and regression evidence before claiming stable performance.",
      )
    : missing(
        "deterministic-performance-and-soak",
        "No executable benchmark harness/report detected.",
        "Add deterministic synthetic-card, renderer lifecycle and regression harnesses.",
      ),
);

rows.push(
  browserReport && has(browserReport, /mediaHeavy/) && has(browserReport, /Video and audio/) || has(browserReport, /media decode and playback/)
    ? partial(
        "media-heavy-real-renderer",
        "Chromium report includes 100/500/2000 image and 1/4/8 video viewport/lease/destroy scales, but explicitly limits video/audio to preview/waveform adapter behavior.",
        "Real media decode/playback, GPU memory and long-duration media churn remain unverified.",
      )
    : missing(
        "media-heavy-real-renderer",
        "No browser media-heavy report with explicit limitations detected.",
        "Run the real browser media-heavy contract and record decode/playback/resource metrics.",
      ),
);

rows.push(
  has(performanceDoc, /2026-08-07 Chromium \/ Konva 对照/) &&
    has(performanceDoc, /matched-visible/) &&
    has(performanceDoc, /full-retained/) &&
    has(performanceDoc, /p50 \/ p95 \/ p99/)
    ? achieved(
        "konva-comparison",
        "The canonical Chromium benchmark records fixed 10k/50k/100k matched-visible and full-retained PixiBoardJS-versus-Konva p50/p95/p99, first-interactive and capture results with fairness checks and explicit SwiftShader limitations.",
        "This is a scoped sparse-card comparison, not a universal superiority claim; hardware GPU metrics and broader media workloads remain open.",
      )
    : missing(
        "konva-comparison",
        "No Konva adapter, matching dataset or result file is present.",
        "Add a fair matched Pixi/Konva benchmark and only make scoped performance claims.",
      ),
);

rows.push(
  hasNightlyWorkflow
    ? partial(
        "nightly-regression-gate",
        "A nightly/benchmark workflow is present, but this audit has no successful full-nightly result artifact.",
        "Run and persist browser/WebGL, 100k, memory/soak, Rust and integration nightly output.",
      )
    : missing(
        "nightly-regression-gate",
        "No nightly browser/benchmark/regression workflow or success artifact is present.",
        "Add nightly browser/WebGL, benchmark, memory/destroy soak and integration jobs with retained reports.",
      ),
);

rows.push(
  await exists("scripts/check-browser-boundary.mjs") &&
    has(browserContract, /without requesting Tauri modules/) &&
    has(browserContract, /Tauri/)
    ? achieved(
        "browser-platform-boundary",
        "Static browser boundary checker and Chromium resource assertion reject Tauri reachability from the browser entry.",
        "Run the boundary check whenever browser entry or adapter dependencies change; this does not imply release tarball success.",
      )
    : partial(
        "browser-platform-boundary",
        "Browser source exists but static/runtime Tauri boundary evidence is incomplete.",
        "Add static dependency and browser resource checks.",
      ),
);

console.log("Requirement audit (current main evidence only; roadmap text is not completion):");
for (const row of rows) {
  console.log(`${row.status.toUpperCase().padEnd(11)} ${row.id}`);
  console.log(`  evidence: ${row.evidence}`);
  console.log(`  missing:  ${row.missing}`);
}

if (rows.some((row) => row.status === "achieved")) {
  console.log("\nAchieved rows are scoped to the evidence above; release artifacts, complete nightly artifacts, real media decode/playback and hardware GPU metrics remain open.");
}
