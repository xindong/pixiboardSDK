export interface SyntheticCardNode {
  id: string;
  type: "card";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  assetId: string;
  data: { title: string; body: string; tags: string[] };
}

export interface SyntheticCardDataset {
  name: "synthetic-card";
  count: 1_000 | 10_000 | 50_000 | 100_000;
  seed: number;
  nodes: SyntheticCardNode[];
  sharedAssets: Array<{ id: string; kind: "image"; width: number; height: number }>;
  metadata: { sparse: true; cardSize: [number, number]; worldBounds: [number, number, number, number] };
}

export interface BenchmarkMetricSample {
  scenario: string;
  dataset: string;
  iteration: number;
  durationMs?: number;
  frameTimeMs?: number;
  documentLoadMs?: number;
  firstInteractiveMs?: number;
  coreTransactionLatencyMs?: number;
  visibleCount?: number;
  activeViewCount?: number;
  heapBytes?: number;
  textureLeaseCount?: number;
  listenerCount?: number;
  tickerCount?: number;
  longFrame: boolean;
  [metric: string]: unknown;
}

export interface BenchmarkSummary {
  sampleCount: number;
  p50FrameTimeMs: number | null;
  p95FrameTimeMs: number | null;
  p99FrameTimeMs: number | null;
  longFrameRatio: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  p95DocumentLoadMs: number | null;
  p95FirstInteractiveMs: number | null;
  p95CoreTransactionLatencyMs: number | null;
  observed: boolean;
}

export interface BenchmarkObservation {
  scenario: string;
  datasetCount?: number;
  status: "observed" | "not-observed";
  reason?: string;
  samples: BenchmarkMetricSample[];
  summary: BenchmarkSummary;
  invariants?: Record<string, boolean | number | string>;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  environment: {
    fingerprint: string;
    runtime: "node";
    node: string;
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    renderer: "instrumented-pixi-adapter";
  };
  seed: number;
  observations: BenchmarkObservation[];
  notObserved: Array<{ metric: string; reason: string }>;
}
