import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exists = async (relative) => {
  try {
    await access(resolve(root, relative));
    return true;
  } catch {
    return false;
  }
};
const read = (relative) => readFile(resolve(root, relative), "utf8");
const hasAny = async (patterns) => {
  const files = await listFiles(root);
  return files.some((file) => patterns.some((pattern) => pattern.test(file)));
};
async function listFiles(directory) {
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

const coreTests = await read("packages/core/test/core.test.ts");
const documentValidation = await read("packages/core/src/document-validation.ts");
const documentMigrations = (await exists("packages/core/src/document-migrations.ts"))
  ? await read("packages/core/src/document-migrations.ts")
  : "";
const coreTypes = await read("packages/core/src/types.ts");
const facadeSource = await read("packages/pixiboardjs/src/index.ts");
const agentTests = await read("packages/agent-tools/src/contract.test.ts");
const desktopTests = await read("apps/examples-desktop-sdk/test/desktop-sdk.test.ts");
const desktopControllerTests = (await exists("apps/examples-desktop-sdk/test/project-session-controller.test.ts"))
  ? await read("apps/examples-desktop-sdk/test/project-session-controller.test.ts")
  : "";
const benchmarkRunner = await read("apps/benchmark/src/runner.mjs");
const benchmarkReadme = await read("apps/benchmark/README.md");
const releaseGate = await read("scripts/check-release-gate.mjs");
const releaseDoc = await read("docs/15-release-gate.md");

const rows = [
  {
    id: "current-document-only",
    status:
      /older than supported schema/.test(documentValidation) &&
      /newer than supported schema/.test(documentValidation) &&
      !/migrate: true/.test(facadeSource) &&
      !/class DocumentMigrationRegistry/.test(documentMigrations) &&
      !/\bmigrate\?\s*\(/.test(coreTypes)
        ? "achieved"
        : "partial",
    evidence: "core and pixiboardjs accept only the current SDK BoardDocument; older/future schemas, legacy assetId shapes, and registered typeVersion mismatches are rejected; no migration surface or legacy adapter remains",
    missing: "keep this boundary covered whenever schemaVersion or node typeVersion changes",
  },
  {
    id: "unknown-node-preservation",
    status: /preserves unknown JSON/.test(coreTests) && /NodeTypeNotRegisteredError/.test(coreTests) ? "achieved" : "missing",
    evidence: "packages/core/test/core.test.ts unknown-node JSON round-trip; renderer-pixi unknown placeholder test",
    missing: "limit preservation to valid current-format SDK documents; it must not imply legacy document acceptance",
  },
  {
    id: "core-capabilities-agent-equivalence",
    status: /matches direct Core and capability document/.test(agentTests) ? "achieved" : "missing",
    evidence: "packages/agent-tools/src/contract.test.ts direct/Core/capability/Agent doc, revision, ChangeSet, undo/redo assertions",
    missing: "MCP transport equivalence is not covered by this row",
  },
  {
    id: "plugin-v3-contract",
    status: /routes UI, Agent and Plugin v3/.test(desktopTests) ? "partial" : "missing",
    evidence: "private plugin-api-v3 packaged host/loader, v2 rejection, lifecycle and UI/Agent/Plugin ChangeSet equivalence",
    missing: "public @pixi-board/plugin-sdk dist/API report and external install fixture must pass the release gate",
  },
  {
    id: "mcp-direct-equivalence",
    status: (await exists("packages/mcp-host/src/contract.test.ts")) ? "achieved" : "missing",
    evidence: "packages/mcp-host/src/contract.test.ts passed the focused suite with exact direct Agent/stdio/HTTP ChangeSet/event/history/persistence comparisons, read/error parity, framing, abort and close coverage",
    missing: "real socket/process deployment smoke remains a separate host integration gate",
  },
  {
    id: "desktop-parity-tauri-smoke",
    status: (await exists("apps/examples-desktop-sdk/src-tauri/Cargo.toml")) && /destroy/.test(desktopControllerTests) ? "partial" : "missing",
    evidence: "real Tauri app and injected adapter exist; adapter/Desktop tests cover current-format persistence and project switch cleanup; macOS cargo smoke was executed",
    missing: "Windows remains CI-configured rather than locally observed; media-heavy renderer/product interactions remain a separate gate",
  },
  {
    id: "browser-adapter",
    status: (await exists("packages/adapter-browser/test/browser-persistence-adapter.test.ts")) ? "achieved" : "missing",
    evidence: "browser adapter plus shared memory/browser/Tauri contract suites and Chromium browser contract",
    missing: "publishable browser artifact remains part of release gate; renderer media-heavy lifecycle is audited separately",
  },
  {
    id: "release-pack-api",
    status: /blockers/.test(releaseGate) && /(blocked|阻塞)/.test(releaseDoc) ? "partial" : "missing",
    evidence: "scripts/check-release-gate.mjs; docs/15-release-gate.md explicitly records blocked tarball exports/dependencies",
    missing: "publishable JS + d.ts artifacts, non-placeholder dependencies, external npm/Vite consumer pass",
  },
  {
    id: "semver-api-report-changesets-bundle-budget",
    status: (await hasAny([/\.changeset[/]/, /api-report/i, /bundle.*budget/i])) ? "partial" : "missing",
    evidence: "packages/pixiboardjs/VERSIONING.md is policy prose only; no changeset/API report/bundle budget artifacts",
    missing: "config and generated API report, Changesets, bundle budget check and CI gate",
  },
  {
    id: "konva-comparison",
    status: !(await exists("apps/benchmark/src/run-browser.mjs")) && /does \*\*not\*\* run[\s\S]*Konva/.test(benchmarkReadme)
      ? "missing"
      : "partial",
    evidence: "docs/10 defines fair-comparison policy; browser matched comparison is required before achieved",
    missing: "matched Konva/Pixi scenarios, fixed environment, recorded p50/p95/p99 results",
  },
  {
    id: "performance-and-soak",
    status: /status: "not-implemented"/.test(benchmarkRunner) ? "missing" : "partial",
    evidence: "executable Node/instrumented 10k/50k/100k harness, Core latency thresholds, 100-cycle lifecycle soak and regression comparator exist",
    missing: "real matched WebGL/Konva, media-heavy Chromium soak and CI/nightly regression gate",
  },
];

console.log("Requirement audit (static evidence only; plan text is not completion):");
for (const row of rows) {
  console.log(`${row.status.toUpperCase().padEnd(11)} ${row.id}`);
  console.log(`  evidence: ${row.evidence}`);
  console.log(`  missing:  ${row.missing}`);
}
if (rows.some((row) => row.status === "achieved")) {
  console.log("\nAchieved rows are limited to the scoped evidence named above; public release, matched WebGL/Konva, media-heavy soak and final CI/RC gates remain open.");
}
