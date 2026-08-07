import { describe, expect, it } from "vitest";
import { createPixiBoardBenchmarkAdapter } from "../src/adapter";
import { runBenchmark } from "../src/run";
import { runBenchmarkScenarios } from "../src/runner.mjs";

describe("real benchmark adapter and runner", () => {
  it("executes the real harness through the adapter entrypoint", async () => {
    const report = await createPixiBoardBenchmarkAdapter().run({
      counts: [1_000], queryIterations: 2, singleUpdateIterations: 1,
      batchIterations: 1, soakCycles: 1, includeFacadeBatch: false,
    });
    expect(report.observations.some((item) => item.scenario === "core-batch-update-1000")).toBe(true);
  });

  it("exposes a callable high-level runner and generic scenario runner", async () => {
    const report = await runBenchmark({ counts: [1_000], queryIterations: 1, singleUpdateIterations: 1, batchIterations: 1, soakCycles: 1, includeFacadeBatch: false });
    expect(report.environment.renderer).toBe("instrumented-pixi-adapter");
    const reports = await runBenchmarkScenarios({
      adapter: { name: "test-real-adapter", "dataset-generation": () => ({ durationMs: 0.1 }) },
      datasets: [{ name: "synthetic-card" }], scenarios: ["dataset-generation"],
    });
    expect(reports[0]).toMatchObject({ status: "observed", observed: true });
  });
});
