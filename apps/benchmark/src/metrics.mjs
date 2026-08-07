function percentile(values, percentileRank) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentileRank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function createMetricSample(sample) {
  if (!sample || typeof sample !== "object") throw new TypeError("metric sample must be an object");
  if (typeof sample.scenario !== "string" || typeof sample.dataset !== "string") {
    throw new TypeError("metric sample requires scenario and dataset");
  }
  return Object.freeze({ ...sample, longFrame: Boolean(sample.longFrame) });
}

export function summarizeMetricSamples(samples) {
  const normalized = samples.map(createMetricSample);
  const frameTimes = normalized.map((sample) => sample.frameTimeMs).filter(Number.isFinite);
  const durations = normalized.map((sample) => sample.durationMs).filter(Number.isFinite);
  const documentLoads = normalized.map((sample) => sample.documentLoadMs).filter(Number.isFinite);
  const firstInteractives = normalized.map((sample) => sample.firstInteractiveMs).filter(Number.isFinite);
  const coreTransactions = normalized.map((sample) => sample.coreTransactionLatencyMs).filter(Number.isFinite);
  const snapshots = normalized.map((sample) => sample.snapshotMaterializationMs).filter(Number.isFinite);
  const rendererApplies = normalized.map((sample) => sample.rendererApplyMs).filter(Number.isFinite);
  return {
    sampleCount: normalized.length,
    p50FrameTimeMs: percentile(frameTimes, 0.5),
    p95FrameTimeMs: percentile(frameTimes, 0.95),
    p99FrameTimeMs: percentile(frameTimes, 0.99),
    longFrameRatio: frameTimes.length ? normalized.filter((sample) => Number.isFinite(sample.frameTimeMs) && sample.longFrame).length / frameTimes.length : null,
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    p99DurationMs: percentile(durations, 0.99),
    p95DocumentLoadMs: percentile(documentLoads, 0.95),
    p95FirstInteractiveMs: percentile(firstInteractives, 0.95),
    p95CoreTransactionLatencyMs: percentile(coreTransactions, 0.95),
    p95SnapshotMaterializationMs: percentile(snapshots, 0.95),
    p95RendererApplyMs: percentile(rendererApplies, 0.95),
    observed: normalized.length > 0,
  };
}

export function createBenchmarkReporter() {
  const samples = [];
  return {
    record(sample) {
      const normalized = createMetricSample(sample);
      samples.push(normalized);
      return normalized;
    },
    samples() {
      return [...samples];
    },
    summarize() {
      return summarizeMetricSamples(samples);
    },
  };
}
