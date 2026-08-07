import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateBrowserEvidence(report, expectedSha) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (report?.runKind !== "canonical" || report?.publishable !== true) failures.push("report must be canonical publishable evidence");
  if (report?.candidate?.sha !== expectedSha) failures.push("report candidate SHA does not match the checked-out candidate");
  if (report?.candidate?.rendererPackage !== "@pixi-board/renderer-pixi" || report?.candidate?.source !== "workspace packages/renderer-pixi/src") failures.push("candidate renderer source is not the workspace PixiBoardRenderer");
  if (report?.performanceAssessment?.classification !== "evidence-only" || report?.performanceAssessment?.blockingPerformanceCriteria !== false || report?.performanceAssessment?.thresholdStatus !== "notEvaluated") failures.push("browser numerical performance must be labeled evidence-only/non-blocking");
  if (report?.fixed?.warmupFrames !== 30 || report?.fixed?.sampleFrames !== 120) failures.push("formal evidence requires 30 warmup and 120 measured frames");
  if (JSON.stringify(report?.fixed?.datasetCounts) !== JSON.stringify([10_000, 50_000, 100_000])) failures.push("formal evidence requires 10k/50k/100k datasets");
  if (report?.validation?.passed !== true || report?.validation?.failures?.length) failures.push("browser structural/fairness validation failed");
  if (!Array.isArray(report?.observations) || report.observations.length !== 12) failures.push("formal evidence requires all 12 mode/count/engine cases");
  else {
    const expected = new Set(["matched-visible", "full-retained"].flatMap((mode) => [10_000, 50_000, 100_000].flatMap((count) => ["pixiboardjs", "konva"].map((engine) => `${mode}/${count}/${engine}`))));
    const seen = new Set();
    for (const item of report.observations) {
      const key = `${item?.mode}/${item?.datasetCount}/${item?.engine}`;
      if (!expected.has(key) || seen.has(key)) failures.push(`${key}: unexpected or duplicate formal matrix observation`);
      seen.add(key);
      const pan = item?.panEvidence;
      if (pan?.scenario !== "deterministic-horizontal-pan" || pan?.viewportWidthPx !== 1920 || !Number.isFinite(pan?.distancePx) || pan.distancePx < 3840 || pan?.endX - pan?.startX !== pan.distancePx || !Number.isFinite(pan?.viewportWidths) || Math.abs(pan.viewportWidths - pan.distancePx / 1920) > 1e-9 || pan?.gridCellWidthPx !== 90 || pan.distancePx < pan.gridCellWidthPx || !Number.isFinite(pan?.gridCellWidths) || Math.abs(pan.gridCellWidths - pan.distancePx / 90) > 1e-9) failures.push(`${key}: invalid multi-viewport pan evidence`);
      if (item?.mode === "matched-visible" && (pan?.visiblePlanChanged !== true || !Number.isInteger(pan?.startVisibleCount) || pan.startVisibleCount < 1 || !Number.isInteger(pan?.endVisibleCount) || pan.endVisibleCount < 1 || typeof pan?.startVisiblePlanHash !== "string" || typeof pan?.endVisiblePlanHash !== "string" || pan.startVisiblePlanHash === pan.endVisiblePlanHash)) failures.push(`${key}: visible plan change was not proven`);
    }
    if (seen.size !== expected.size) failures.push("formal browser matrix is incomplete");
  }
  return failures;
}

export async function runBrowserBenchmarkGate(profile = process.argv[2]) {
  if (!["nightly", "rc"].includes(profile)) throw new Error("browser benchmark evidence profile must be nightly or rc");
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const expectedSha = (process.env.PIXIBOARD_CANDIDATE_SHA || await gitHead(repoRoot)).trim();
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) throw new Error("PIXIBOARD_CANDIDATE_SHA must be a full 40-character commit SHA");
  const output = resolve(process.env.PIXIBOARD_BROWSER_GATE_REPORT ?? `.artifacts/performance/${profile}-browser.json`);
  const exitCode = await run("pnpm", ["--filter", "pixiboardjs-benchmark", "benchmark:browser"], repoRoot, {
    ...process.env,
    PIXIBOARD_CANDIDATE_SHA: expectedSha,
    PIXIBOARD_BROWSER_OUTPUT: output,
  });
  if (exitCode !== 0) throw new Error(`canonical browser benchmark exited ${exitCode}`);
  const report = JSON.parse(await readFile(output, "utf8"));
  const failures = validateBrowserEvidence(report, expectedSha);
  if (failures.length) throw new Error(`Browser evidence contract failed:\n- ${failures.join("\n- ")}`);
  console.log(`Browser structural/fairness evidence accepted for ${expectedSha}.`);
  console.log("Numerical browser performance is evidence-only/non-blocking: no baseline delta or absolute budget was evaluated.");
  return { output, report };
}

function gitHead(cwd) {
  return new Promise((resolveHead, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveHead(stdout) : reject(new Error(`git rev-parse exited ${code}`)));
  });
}

function run(command, args, cwd, env) {
  return new Promise((resolveExit) => {
    const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
    const child = spawn(executable, args, { cwd, env, stdio: "inherit" });
    child.on("error", (error) => { console.error(error); resolveExit(1); });
    child.on("exit", (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runBrowserBenchmarkGate();
