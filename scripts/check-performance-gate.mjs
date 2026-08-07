import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/check-performance-gate.mjs <pr|nightly|rc>");
  process.exit(0);
}

const profile = process.argv[2];
if (!["pr", "nightly", "rc"].includes(profile)) throw new Error("performance gate profile must be pr, nightly or rc");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(process.env.PIXIBOARD_PERFORMANCE_DIR ?? `.artifacts/performance/${profile}`);
const nodeReportPath = join(artifactDir, "node.json");
const browserReportPath = join(artifactDir, "browser.json");
const summaryPath = join(artifactDir, "summary.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
await mkdir(artifactDir, { recursive: true });

for (const packageName of ["@pixi-board/core", "pixiboardjs"]) {
  const buildCode = await run(pnpm, ["--filter", packageName, "build"]);
  if (buildCode !== 0) throw new Error(`${packageName} build exited ${buildCode}`);
}

const benchmarkScript = profile === "pr" ? "benchmark:report" : "benchmark:run";
const benchmarkCode = await run(pnpm, ["--filter", "pixiboardjs-benchmark", benchmarkScript], { PIXIBOARD_BENCHMARK_REPORT: nodeReportPath });
if (benchmarkCode !== 0) throw new Error(`benchmark command exited ${benchmarkCode}`);
const nodeReport = JSON.parse(await readFile(nodeReportPath, "utf8"));
const blockers = validateNodeReport(nodeReport);
let browserReport = null;

if (profile !== "pr") {
  const browserCode = await run(process.execPath, [resolve(root, "scripts/run-browser-benchmark-gate.mjs"), profile], {
    PIXIBOARD_BROWSER_GATE_REPORT: browserReportPath,
    PIXIBOARD_CANDIDATE_SHA: process.env.PIXIBOARD_CANDIDATE_SHA ?? process.env.CANDIDATE_SHA ?? "",
  });
  if (browserCode !== 0) blockers.push(`canonical browser evidence command exited ${browserCode}`);
  else browserReport = JSON.parse(await readFile(browserReportPath, "utf8"));
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  profile,
  passed: blockers.length === 0,
  blockers: [...new Set(blockers)],
  nodePerformanceCriteria: "blocking",
  browserPerformanceCriteria: browserReport?.performanceAssessment ?? (profile === "pr" ? "notRunForPr" : "notRunBecauseNodeGateFailed"),
  evidence: { node: "node.json", browser: browserReport ? "browser.json" : null },
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

if (summary.blockers.length) {
  console.error(`Performance ${profile} delivery check failed:`);
  for (const blocker of summary.blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log(`Node performance ${profile} criteria passed with ${nodeReport.observations.length} observed scenarios.`);
  if (browserReport) console.log("Candidate-bound Chromium/Konva evidence is structurally accepted; numerical browser performance remains evidence-only/non-blocking.");
}

function validateNodeReport(report) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push("Node report schemaVersion must be 1");
  if (!report?.environment?.fingerprint || report?.environment?.runtime !== "node") failures.push("Node runtime fingerprint is missing or invalid");
  if (!Array.isArray(report?.observations) || !report.observations.length) failures.push("Node observations are missing");
  for (const observation of report?.observations ?? []) {
    if (observation.status !== "observed" || !Array.isArray(observation.samples) || !observation.samples.length || !observation.summary?.observed) failures.push(`Node observation ${observation.scenario ?? "unknown"}/${observation.datasetCount ?? "all"} is not observed`);
  }
  for (const target of report?.targetEvaluations ?? []) if (target.passed !== true) failures.push(`Node target failed: ${target.scenario}/${target.datasetCount ?? "all"} (${target.target})`);
  if (profile !== "pr") {
    for (const count of [10_000, 50_000, 100_000]) {
      const spatial = report?.observations?.find((item) => item.scenario === "spatial-rebuild" && item.datasetCount === count);
      if (spatial?.invariants?.indexedNodeCount !== count) failures.push(`Node report did not index all ${count} nodes`);
    }
    const soak = report?.observations?.find((item) => item.scenario === "create-destroy-soak");
    if (soak?.invariants?.cycles !== 100 || soak?.invariants?.returnedToBaselineEveryCycle !== true) failures.push("Node gate requires a passing 100-cycle SDK create/destroy soak");
  }
  return failures;
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...extraEnv } });
    child.on("error", (error) => { console.error(error); resolveExit(1); });
    child.on("exit", (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
  });
}
