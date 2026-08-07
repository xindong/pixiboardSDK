import { BENCHMARK_SCENARIOS } from "./scenarios.mjs";
import { createBenchmarkReporter } from "./metrics.mjs";

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

export function createBenchmarkAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || typeof adapter.name !== "string") {
    throw new TypeError("benchmark adapter requires a name");
  }
  return adapter;
}

/** Run concrete adapter operations and return one report per dataset/scenario. */
export async function runBenchmarkScenarios({ adapter, datasets, scenarios, iterations = 1, warmup = 0 }) {
  const normalizedAdapter = createBenchmarkAdapter(adapter);
  const reports = [];
  for (const dataset of datasets ?? [{ name: "unknown" }]) {
    for (const scenario of scenarios ?? BENCHMARK_SCENARIOS) {
      reports.push(await runScenario({ adapter: normalizedAdapter, dataset, scenario, iterations, warmup }));
    }
  }
  return reports;
}

export async function runScenario({ adapter, dataset, scenario, iterations = 1, warmup = 0 }) {
  if (!BENCHMARK_SCENARIOS.includes(scenario)) {
    throw new RangeError(`unknown benchmark scenario: ${scenario}`);
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError("iterations must be a positive integer");
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new RangeError("warmup must be a non-negative integer");
  }

  const normalizedAdapter = createBenchmarkAdapter(adapter);
  const operation = normalizedAdapter[scenario];
  if (typeof operation !== "function") {
    return {
      status: "not-observed",
      adapter: normalizedAdapter.name,
      scenario,
      dataset: dataset?.name ?? "unknown",
      reason: `adapter does not expose an observable ${scenario} operation`,
      observed: false,
      samples: [],
      summary: createBenchmarkReporter().summarize(),
    };
  }

  for (let iteration = 0; iteration < warmup; iteration += 1) {
    await operation({ dataset, iteration, phase: "warmup" });
    await yieldToEventLoop();
  }

  const reporter = createBenchmarkReporter();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = await operation({ dataset, iteration, phase: "measure" });
    reporter.record({
      scenario,
      dataset: dataset?.name ?? "unknown",
      iteration,
      ...sample,
    });
    await yieldToEventLoop();
  }

  return {
    status: "observed",
    adapter: normalizedAdapter.name,
    scenario,
    dataset: dataset?.name ?? "unknown",
    observed: true,
    samples: reporter.samples(),
    summary: reporter.summarize(),
  };
}

export function createEmptyReport({ environment = "unspecified", adapter = "none" } = {}) {
  const reporter = createBenchmarkReporter();
  return {
    status: "not-observed",
    observed: false,
    environment,
    adapter,
    samples: reporter.samples(),
    summary: reporter.summarize(),
  };
}
