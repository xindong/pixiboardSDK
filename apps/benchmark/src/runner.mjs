import { BENCHMARK_SCENARIOS } from "./scenarios.mjs";
import { createBenchmarkReporter } from "./metrics.mjs";

/**
 * Renderer/core adapters can implement these operations in a later milestone.
 * The skeleton deliberately does not provide a default adapter or fabricate
 * timings when an operation is absent.
 */
export function createBenchmarkAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || typeof adapter.name !== "string") {
    throw new TypeError("benchmark adapter requires a name");
  }
  return adapter;
}

export async function runScenario({ adapter, dataset, scenario, iterations = 1, warmup = 0 }) {
  if (!BENCHMARK_SCENARIOS.includes(scenario)) throw new RangeError(`unknown benchmark scenario: ${scenario}`);
  const normalizedAdapter = createBenchmarkAdapter(adapter);
  const operation = normalizedAdapter[scenario];
  if (typeof operation !== "function") {
    return {
      status: "not-implemented",
      adapter: normalizedAdapter.name,
      scenario,
      dataset: dataset?.name ?? "unknown",
      reason: `adapter does not implement ${scenario}`,
      observed: false,
    };
  }

  // Warmup and measurement are intentionally delegated to a future adapter;
  // this function only defines the no-fake-results contract for now.
  void iterations;
  void warmup;
  void operation;
  return {
    status: "not-implemented",
    adapter: normalizedAdapter.name,
    scenario,
    dataset: dataset?.name ?? "unknown",
    reason: "renderer-backed timing harness is not included in the planning skeleton",
    observed: false,
  };
}

export function createEmptyReport({ environment = "unspecified", adapter = "none" } = {}) {
  const reporter = createBenchmarkReporter();
  return {
    status: "skeleton",
    observed: false,
    environment,
    adapter,
    samples: reporter.samples(),
    summary: reporter.summarize(),
  };
}
