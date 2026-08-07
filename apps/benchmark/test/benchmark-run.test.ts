import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runDeterministicBenchmark } from "../src/harness";

const requested = process.env.PIXIBOARD_BENCHMARK_RUN === "1";

describe.runIf(requested)("deterministic benchmark report", () => {
  it("runs the real core, spatial, instrumented renderer and lifecycle harness", async () => {
    const report = await runDeterministicBenchmark();
    expect(report.deterministic.counts).toEqual([1_000, 10_000, 50_000, 100_000]);
    expect(report.observations.every((observation) => observation.status === "observed")).toBe(true);
    expect(report.observations.find((observation) => observation.scenario === "create-destroy-soak")?.invariants?.returnedToBaselineEveryCycle).toBe(true);
    expect(report.notObserved.length).toBeGreaterThan(0);

    const output = process.env.PIXIBOARD_BENCHMARK_REPORT;
    if (output) {
      const destination = resolve(process.cwd(), output);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.log(`PIXIBOARD_BENCHMARK_SUMMARY ${JSON.stringify({
      environment: report.environment,
      observations: report.observations.map((observation) => ({
        scenario: observation.scenario,
        datasetCount: observation.datasetCount,
        p95DurationMs: observation.summary.p95DurationMs,
        p95CoreTransactionLatencyMs: observation.summary.p95CoreTransactionLatencyMs,
        p95FirstInteractiveMs: observation.summary.p95FirstInteractiveMs,
        invariants: observation.invariants,
      })),
      targetEvaluations: report.targetEvaluations,
      notObserved: report.notObserved,
    })}`);
  });
});
