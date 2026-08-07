import { describe, expect, it } from "vitest";
import { createPixiBoardBenchmarkAdapter } from "../src/adapter";

const requested = process.env.PIXIBOARD_BENCHMARK_MATRIX === "1";
const counts = [10_000, 50_000, 100_000];
const measuredScenarios = [
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
];

describe.runIf(requested)("real 10k/50k/100k benchmark matrix", () => {
  it("observes every required scale and completes a 100-cycle soak", async () => {
    const report = await createPixiBoardBenchmarkAdapter().run({
      counts,
      queryIterations: 2,
      singleUpdateIterations: 1,
      batchIterations: 1,
      soakCycles: 100,
      includeFacadeBatch: true,
    });

    for (const count of counts) {
      for (const scenario of measuredScenarios) {
        const observation = report.observations.find((item) => item.scenario === scenario && item.datasetCount === count);
        expect(observation, `${scenario}:${count}`).toBeDefined();
        expect(observation?.status, `${scenario}:${count} status`).toBe("observed");
        expect(observation?.summary.sampleCount, `${scenario}:${count} samples`).toBeGreaterThan(0);
      }
      const culling = report.observations.find((item) => item.scenario === "renderer-culling" && item.datasetCount === count);
      expect(culling?.invariants?.activeViewsBelow1_5xVisible).toBe(true);
      expect(culling?.invariants?.doesNotCreateAllDocumentViews).toBe(true);
      expect(culling?.invariants?.retentionMode).toBe("matched-visible");
      expect(culling?.invariants?.viewport).toBe("1920x1080@1");
      const retained = report.observations.find((item) => item.scenario === "renderer-culling-full-retained" && item.datasetCount === count);
      expect(retained?.invariants).toMatchObject({ retentionMode: "full-retained", activeViewsEqualExpectedSet: true, doesNotCreateAllDocumentViews: false });
      const batch = report.observations.find((item) => item.scenario === "core-batch-update-1000" && item.datasetCount === count);
      expect(batch?.invariants).toMatchObject({
        batchSize: 1000,
        oneRevisionPerBatch: true,
        oneChangeSetPerBatch: true,
        changeSetContains1000Nodes: true,
      });
    }

    const facadeBatch = report.observations.find((item) => item.scenario === "facade-batch-update-1000");
    expect(facadeBatch?.invariants).toMatchObject({ oneRevision: true, oneChangeSet: true, onePersistenceSave: true });
    const soak = report.observations.find((item) => item.scenario === "create-destroy-soak");
    expect(soak?.invariants).toMatchObject({
      cycles: 100,
      listenerBaseline: 0,
      tickerBaseline: 0,
      viewBaseline: 0,
      textureBaseline: 0,
      returnedToBaselineEveryCycle: true,
    });
  }, 900_000);
});
