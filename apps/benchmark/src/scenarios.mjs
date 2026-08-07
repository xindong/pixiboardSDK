export const BENCHMARK_SCENARIOS = Object.freeze([
  "pan",
  "zoom",
  "fit-all",
  "fit-selected",
  "selection",
  "drag-1",
  "drag-10",
  "drag-100",
  "batch-create-1000",
  "batch-update-1000",
  "batch-delete-1000",
  "view-churn",
  "create-destroy-soak",
]);

export function describeScenario(name) {
  if (!BENCHMARK_SCENARIOS.includes(name)) throw new RangeError(`unknown benchmark scenario: ${name}`);
  return {
    name,
    status: "not-implemented",
    reason: "Renderer-backed deterministic harness is a later milestone; no measurements are reported here.",
  };
}
