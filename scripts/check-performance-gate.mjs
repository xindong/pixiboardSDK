import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const profile = process.argv[2];
if (!["pr", "nightly", "rc"].includes(profile)) throw new Error("performance gate profile must be pr, nightly or rc");
const reportPath = resolve(process.env.PIXIBOARD_PERFORMANCE_REPORT ?? `.artifacts/performance/${profile}.json`);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const benchmarkScript = profile === "pr" ? "benchmark:report" : "benchmark:run";
const facadeBuildExitCode = await run(pnpm, ["--filter", "pixiboardjs", "build"]);
if (facadeBuildExitCode !== 0) throw new Error(`pixiboardjs build command exited ${facadeBuildExitCode}`);
const exitCode = await run(pnpm, ["--filter", "pixiboardjs-benchmark", benchmarkScript]);
if (exitCode !== 0) throw new Error(`benchmark command exited ${exitCode}`);

const report = JSON.parse(await readFile(reportPath, "utf8"));
const blockers = [];
validateSchema(report, blockers);
if (profile !== "pr") {
  for (const requiredMetric of ["browser/WebGL frame time", "Konva comparison"]) {
    if (report.notObserved?.some((item) => String(item?.metric ?? item).includes(requiredMetric))) {
      blockers.push(`${profile} requires observed ${requiredMetric}; the real Node harness reports it as not-observed`);
    }
  }
  for (const count of [10_000, 50_000, 100_000]) {
    if (!report.observations?.some((item) => item.datasetCount === count && item.status === "observed")) blockers.push(`${profile} report is missing observed ${count}-node results`);
  }
  const soak = report.observations?.find((item) => item.scenario === "create-destroy-soak");
  if (soak?.invariants?.cycles !== 100 || soak?.invariants?.returnedToBaselineEveryCycle !== true) blockers.push(`${profile} requires a passing 100-cycle create/destroy soak`);
}

if (blockers.length > 0) {
  console.error(`Performance ${profile} gate failed:`);
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log(`Performance ${profile} gate passed with ${report.observations.length} observed scenarios.`);
}

function validateSchema(report, blockers) {
  if (report?.schemaVersion !== 1) blockers.push("report schemaVersion must be 1");
  if (typeof report?.generatedAt !== "string") blockers.push("report generatedAt is missing");
  if (!report?.environment?.fingerprint) blockers.push("report environment fingerprint is missing");
  if (report?.environment?.runtime !== "node") blockers.push("report runtime must identify the executed Node harness");
  if (!Array.isArray(report?.observations) || report.observations.length === 0) blockers.push("report observations are missing");
  if (!Array.isArray(report?.targetEvaluations)) blockers.push("report targetEvaluations are missing");
  if (!Array.isArray(report?.notObserved)) blockers.push("report notObserved is missing");
  for (const observation of report?.observations ?? []) {
    if (observation.status !== "observed" || !Array.isArray(observation.samples) || !observation.summary?.observed) {
      blockers.push(`observation ${observation.scenario ?? "unknown"}/${observation.datasetCount ?? "all"} is not an observed schema result`);
    }
  }
  for (const target of report?.targetEvaluations ?? []) {
    if (target.passed !== true) blockers.push(`target failed: ${target.scenario}/${target.datasetCount ?? "all"} (${target.target})`);
  }
}

function run(command, commandArgs) {
  return new Promise((resolveExit) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", env: { ...process.env, PIXIBOARD_PERFORMANCE_REPORT: reportPath, PIXIBOARD_BENCHMARK_REPORT: reportPath } });
    child.on("error", (error) => { console.error(error); resolveExit(1); });
    child.on("exit", (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
  });
}
