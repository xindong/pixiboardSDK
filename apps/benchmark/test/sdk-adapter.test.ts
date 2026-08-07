import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSdkBenchmarkAdapter } from "../src/sdk-adapter.mjs";

describe("SDK benchmark adapter", () => {
  it("runs real harness work and writes a JSON report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pixiboard-sdk-benchmark-"));
    const reportPath = join(directory, "report.json");
    try {
      const report = await createSdkBenchmarkAdapter().run({
        counts: [1_000],
        queryIterations: 1,
        singleUpdateIterations: 1,
        batchIterations: 1,
        soakCycles: 2,
        includeFacadeBatch: false,
        reportPath,
      });
      const written = JSON.parse(await readFile(reportPath, "utf8"));
      expect(report.environment.renderer).toBe("instrumented-pixi-adapter");
      expect(written.observations.some((item: { scenario: string }) => item.scenario === "core-batch-update-1000")).toBe(true);
      expect(written.observations.find((item: { scenario: string }) => item.scenario === "create-destroy-soak")?.invariants?.cycles).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
