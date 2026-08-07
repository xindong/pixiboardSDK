import { describe, expect, it } from "vitest";
import { runSdkBenchmarkReport } from "../src/sdk-adapter.mjs";

const requested = process.env.PIXIBOARD_SDK_BENCHMARK_REPORT === "1";

describe.runIf(requested)("SDK benchmark report command", () => {
  it("runs the requested real scale and emits a report path", async () => {
    const reportPath = process.env.PIXIBOARD_BENCHMARK_REPORT ?? "/tmp/pixiboard-sdk-benchmark-report.json";
    const report = await runSdkBenchmarkReport({
      counts: [10_000],
      queryIterations: 2,
      singleUpdateIterations: 1,
      batchIterations: 1,
      soakCycles: 100,
      includeFacadeBatch: true,
      reportPath,
    });
    expect(report.observations.some((item) => item.scenario === "document-load" && item.datasetCount === 10_000)).toBe(true);
    expect(report.observations.find((item) => item.scenario === "create-destroy-soak")?.invariants?.returnedToBaselineEveryCycle).toBe(true);
    console.log(`SDK_BENCHMARK_REPORT ${reportPath}`);
  }, 900_000);
});
