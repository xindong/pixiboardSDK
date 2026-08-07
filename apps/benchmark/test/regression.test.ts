import { describe, expect, it } from "vitest";
import { compareBenchmarkReports } from "../src/regression.mjs";

function report(value: number, fingerprint = "same") {
  return {
    environment: { fingerprint },
    observations: [{
      scenario: "core-single-node-update",
      datasetCount: 10_000,
      status: "observed",
      summary: { p95CoreTransactionLatencyMs: value },
    }],
  };
}

describe("benchmark regression threshold", () => {
  it("passes at the 10% boundary and fails above it", () => {
    expect(compareBenchmarkReports(report(10), report(11)).passed).toBe(true);
    const failed = compareBenchmarkReports(report(10), report(11.01));
    expect(failed.passed).toBe(false);
    expect(failed.regressions[0]).toMatchObject({ metric: "p95CoreTransactionLatencyMs" });
  });

  it("rejects cross-environment comparisons unless explicitly allowed", () => {
    expect(compareBenchmarkReports(report(10, "a"), report(9, "b")).passed).toBe(false);
    expect(compareBenchmarkReports(report(10, "a"), report(9, "b"), { allowEnvironmentMismatch: true }).passed).toBe(true);
  });

  it("fails when an observed baseline becomes not-observed", () => {
    const candidate = report(10);
    candidate.observations[0].status = "not-observed";
    expect(compareBenchmarkReports(report(10), candidate).passed).toBe(false);
  });
});
