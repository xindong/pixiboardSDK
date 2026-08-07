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
const benchmarkRunner = await read("apps/benchmark/src/runner.mjs");
const benchmarkReadme = await read("apps/benchmark/README.md");
const releaseGate = await read("scripts/check-release-gate.mjs");
const releaseDoc = await read("docs/15-release-gate.md");

const rows = [
  {
    id: "current-document-only",
    status:
      /requires migration/.test(documentValidation) &&
      /newer than supported schema/.test(documentValidation) &&
      !/migrate: true/.test(facadeSource) &&
      !/class DocumentMigrationRegistry/.test(documentMigrations) &&
      !/\bmigrate\?\s*\(/.test(coreTypes)
        ? "achieved"
        : "partial",
    evidence: "core rejects older schemas when migration is disabled and rejects future schemas; no schema-v4/old-project adapter found",
    missing: "pixiboardjs persistence still loads with migrate:true and Core still exposes document/node migration surfaces; require explicit rejection tests without adding a legacy adapter",
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
    evidence: "packages/plugin-api-v3/src/contract.test.ts and desktop fixture; v2 manifest rejection",
    missing: "packaged plugin host/zip loader and public @pixi-board/plugin-sdk release artifact",
  },
  {
    id: "mcp-direct-equivalence",
    status: (await exists("packages/mcp-host/src/contract.test.ts")) ? "achieved" : "missing",
    evidence: "packages/mcp-host/src/contract.test.ts covers direct Agent, stdio, HTTP document/revision/ChangeSet/history/persistence equivalence, error mapping, abort and close",
    missing: "real socket/process integration remains a separate host deployment gate",
  },
  {
    id: "desktop-parity-tauri-smoke",
    status: /headless: true/.test(desktopTests) ? "partial" : "missing",
    evidence: "apps/examples-desktop-sdk/test/desktop-sdk.test.ts uses headless MemoryTauriDocumentPort",
    missing: "actual Tauri app, macOS/Windows launch smoke, current-format project/media/project-switch parity; old projects are out of SDK scope",
  },
  {
    id: "browser-adapter",
    status: (await exists("packages/adapter-browser/test/browser-persistence-adapter.test.ts")) ? "achieved" : "missing",
    evidence: "adapter-browser tests plus tests/browser/browser-contract.spec.ts",
    missing: "same contract suite on memory/browser/Tauri and full File/Blob/media import parity",
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
    status: /not-implemented/.test(benchmarkRunner) && /does \*\*not\*\* run[\s\S]*Konva/.test(benchmarkReadme)
      ? "missing"
      : "partial",
    evidence: "docs/10 defines fair-comparison policy; no Konva adapter/dataset/results",
    missing: "matched Konva/Pixi scenarios, fixed environment, recorded p50/p95/p99 results",
  },
  {
    id: "performance-and-soak",
    status: /status: "not-implemented"/.test(benchmarkRunner) ? "missing" : "partial",
    evidence: "apps/benchmark/src/runner.mjs returns observed:false; README says no real renderer/WebGL measurements",
    missing: "10k/50k/100k measured thresholds, memory/texture/listener soak, CI/nightly regression gate",
  },
];

console.log("Requirement audit (static evidence only; plan text is not completion):");
for (const row of rows) {
  console.log(`${row.status.toUpperCase().padEnd(11)} ${row.id}`);
  console.log(`  evidence: ${row.evidence}`);
  console.log(`  missing:  ${row.missing}`);
}
if (rows.some((row) => row.status === "achieved")) {
  console.log("\nAchieved rows are limited to the scoped evidence named above; document-format, release, and performance gates remain open.");
}
