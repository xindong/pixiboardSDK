export const DEFAULT_REGRESSION_TOLERANCE = 0.1;

const DEFAULT_METRICS = Object.freeze([
  "p95DurationMs",
  "p95DocumentLoadMs",
  "p95FirstInteractiveMs",
  "p95CoreTransactionLatencyMs",
]);

function observationKey(observation) {
  return `${observation.scenario}:${observation.datasetCount ?? "all"}`;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function compareBenchmarkReports(baseline, candidate, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_REGRESSION_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("regression tolerance must be a non-negative number");
  }
  const environmentMatches = baseline?.environment?.fingerprint === candidate?.environment?.fingerprint;
  if (!environmentMatches && !options.allowEnvironmentMismatch) {
    return {
      passed: false,
      tolerance,
      environmentMatches,
      comparisons: [],
      regressions: [{
        key: "environment",
        metric: "fingerprint",
        reason: `baseline ${baseline?.environment?.fingerprint ?? "unknown"} does not match candidate ${candidate?.environment?.fingerprint ?? "unknown"}`,
      }],
    };
  }

  const candidateByKey = new Map((candidate?.observations ?? []).map((item) => [observationKey(item), item]));
  const comparisons = [];
  const regressions = [];
  for (const baselineObservation of baseline?.observations ?? []) {
    if (baselineObservation.status !== "observed") continue;
    const key = observationKey(baselineObservation);
    const candidateObservation = candidateByKey.get(key);
    if (!candidateObservation || candidateObservation.status !== "observed") {
      regressions.push({ key, metric: "status", reason: "an observed baseline became not-observed or disappeared" });
      continue;
    }
    for (const metric of options.metrics ?? DEFAULT_METRICS) {
      const baselineValue = baselineObservation.summary?.[metric];
      const candidateValue = candidateObservation.summary?.[metric];
      if (!finite(baselineValue)) continue;
      if (!finite(candidateValue)) {
        regressions.push({ key, metric, reason: "candidate metric is not observed" });
        continue;
      }
      const limit = baselineValue * (1 + tolerance);
      const passed = candidateValue <= limit;
      const comparison = { key, metric, baseline: baselineValue, candidate: candidateValue, limit, passed };
      comparisons.push(comparison);
      if (!passed) regressions.push({ ...comparison, reason: `candidate exceeds the ${(tolerance * 100).toFixed(1)}% regression limit` });
    }
  }
  return { passed: regressions.length === 0, tolerance, environmentMatches, comparisons, regressions };
}
