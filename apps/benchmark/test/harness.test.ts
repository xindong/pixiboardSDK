import { describe, expect, it } from "vitest";
import { runDeterministicBenchmark } from "../src/harness";

describe("benchmark harness smoke", () => {
  it("executes measured operations and keeps unavailable metrics explicit", async () => {
    const report = await runDeterministicBenchmark({
      counts: [1_000],
      queryIterations: 3,
      singleUpdateIterations: 1,
      batchIterations: 1,
      soakCycles: 2,
      includeFacadeBatch: false,
    });

    expect(report.observations.map((item) => item.scenario)).toEqual(expect.arrayContaining([
      "dataset-generation",
      "spatial-query",
      "renderer-culling",
      "renderer-culling-full-retained",
      "core-document-snapshot",
      "core-single-node-update-cold",
      "core-single-node-update-transition",
      "core-single-node-update",
      "core-batch-update-1000-cold",
      "core-batch-update-1000-transition",
      "core-batch-update-1000",
      "create-destroy-soak",
    ]));
    expect(report.observations.every((item) => item.observed)).toBe(true);
    expect(report.observations.find((item) => item.scenario === "renderer-culling")?.invariants).toMatchObject({ retentionMode: "matched-visible", viewport: "1920x1080@1" });
    expect(report.observations.find((item) => item.scenario === "renderer-culling-full-retained")?.invariants).toMatchObject({ retentionMode: "full-retained", activeViewsEqualExpectedSet: true });
    expect(report.targetEvaluations.filter((item) => item.scenario.startsWith("core-")).every((item) =>
      item.measurement === "steady-state after separately reported cold and transition transactions")).toBe(true);
    expect(report.notObserved.map((item) => item.metric).join(" ")).toContain("WebGL");
  });
});
