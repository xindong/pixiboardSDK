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
const agentTests = await read("packages/agent-tools/src/contract.test.ts");
const desktopTests = await read("apps/examples-desktop-sdk/test/desktop-sdk.test.ts");
const benchmarkRunner = await read("apps/benchmark/src/runner.mjs");
const benchmarkReadme = await read("apps/benchmark/README.md");
const releaseGate = await read("scripts/check-release-gate.mjs");
const releaseDoc = await read("docs/15-release-gate.md");

const rows = [
  {
    id: "old-snapshot-migration",
    status: "missing",
    evidence: "packages/core/test/core.test.ts (synthetic 1→2 migration only); no real fixture files found",
    missing: "real ../pixi-board schema-v4 board/assets snapshots, adapter load + lossless round-trip, fixture runner",
  },
  {
    id: "unknown-node-preservation",
    status: /preserves unknown JSON/.test(coreTests) && /NodeTypeNotRegisteredError/.test(coreTests) ? "achieved" : "missing",
    evidence: "packages/core/test/core.test.ts unknown-node JSON round-trip; renderer-pixi unknown placeholder test",
    missing: "real legacy fixture coverage remains a separate migration gate",
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
    status: (await exists("packages/mcp-host")) ? "partial" : "missing",
    evidence: "No packages/mcp-host or SDK MCP transport found",
    missing: "HTTP and stdio MCP round-trip plus direct Agent result equivalence",
  },
  {
    id: "desktop-parity-tauri-smoke",
    status: /headless: true/.test(desktopTests) ? "partial" : "missing",
    evidence: "apps/examples-desktop-sdk/test/desktop-sdk.test.ts uses headless MemoryTauriDocumentPort",
    missing: "actual Tauri app, macOS/Windows launch smoke, old-project/media/project-switch parity",
  },
  {
    id: "browser-adapter",
    status: (await exists("packages/adapter-browser/test/browser-persistence-adapter.test.ts")) ? "partial" : "missing",
    evidence: "adapter-browser tests plus tests/browser/browser-contract.spec.ts",
    missing: "same contract suite on memory/browser/Tauri and full File/Blob/media import parity",
  },
  {
    id: "release-pack-api",
    status: /blockers/.test(releaseGate) && /blocked/.test(releaseDoc) ? "partial" : "missing",
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
    status: /not-implemented/.test(benchmarkRunner) && /Konva/.test(benchmarkReadme) === false ? "missing" : "partial",
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
  console.log("\nAchieved rows are limited to the scoped evidence named above; release/performance/legacy gates remain open.");
}
