/**
 * SDK-facing benchmark adapter.
 *
 * The adapter deliberately loads the TypeScript runner through the active
 * Vite/Vitest module graph; it then executes the real BoardCore,
 * GridSpatialIndex, PixiBoardRenderer and pixiboardjs facade harness.
 */
export function createSdkBenchmarkAdapter({ loadRunner = () => import("./run.ts") } = {}) {
  return Object.freeze({
    name: "pixiboardjs-sdk",
    async run(options = {}) {
      const runner = await loadRunner();
      if (!runner || typeof runner.runBenchmark !== "function") {
        throw new TypeError("SDK benchmark runner must export runBenchmark()");
      }
      return runner.runBenchmark(options);
    },
  });
}

export async function runSdkBenchmarkReport(options = {}) {
  return createSdkBenchmarkAdapter().run(options);
}
