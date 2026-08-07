export const BENCHMARK_TARGETS = Object.freeze({
  "10k-pan-zoom": { datasetCount: 10_000, visibleCount: 200, p95FrameTimeMs: 16.7, longFrameRatioMax: 0.01 },
  "50k-pan-zoom": { datasetCount: 50_000, visibleCount: 300, p95FrameTimeMs: 20 },
  "100k-first-interactive": { datasetCount: 100_000, visibleCount: 300, firstInteractiveMs: 2_000 },
  activeViewsMultiplierMax: 1.5,
  coreSingleNodeUpdateP95Ms: 2,
  coreBatch1000P95Ms: 50,
  capture1080pP95Ms: 500,
});
