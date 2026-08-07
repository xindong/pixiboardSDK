export const BENCHMARK_SCENARIOS = Object.freeze([
  "dataset-generation",
  "document-load",
  "spatial-rebuild",
  "spatial-query",
  "renderer-culling",
  "renderer-culling-full-retained",
  "renderer-single-node-apply",
  "core-document-snapshot",
  "core-single-node-update-cold",
  "core-single-node-update-transition",
  "core-single-node-update",
  "core-batch-update-1000-cold",
  "core-batch-update-1000-transition",
  "core-batch-update-1000",
  "facade-batch-update-1000",
  "create-destroy-soak",
]);

export function describeScenario(name) {
  if (!BENCHMARK_SCENARIOS.includes(name)) {
    throw new RangeError(`unknown benchmark scenario: ${name}`);
  }
  return {
    name,
    status: "implemented",
    deterministicInputs: true,
    timings: "observed only when the corresponding operation executes",
  };
}
