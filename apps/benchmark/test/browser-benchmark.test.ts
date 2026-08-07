import { describe, expect, it } from "vitest";
import { BROWSER_BENCHMARK_DEFAULTS, computeFairnessChecks, resolveBrowserBenchmarkConfig, runBrowserBenchmark, validateBrowserObservations } from "../src/browser-runner.mjs";
describe("real browser benchmark contract", () => {
  it("keeps the canonical matrix fixed", () => { expect(BROWSER_BENCHMARK_DEFAULTS).toMatchObject({ counts: [10_000, 50_000, 100_000], modes: ["matched-visible", "full-retained"], engines: ["pixiboardjs", "konva"], viewport: { width: 1920, height: 1080 }, dpr: 1, seed: 42, warmupFrames: 30, sampleFrames: 120 }); });
  it("separates smoke from canonical evidence", () => { expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_COUNTS: "1000" })).toThrow(/10000/); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_COUNTS: "," })).toThrow(/empty/); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_COUNTS: "10000,10000" })).toThrow(/duplicates/); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_COUNTS: "10000" })).toThrow(/complete canonical matrix/); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SAMPLES: "5" })).toThrow(/30 warmup and 120/); expect(resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SMOKE: "1", PIXIBOARD_BROWSER_SAMPLES: "5" })).toMatchObject({ smoke: true, canonical: false, sampleFrames: 5 }); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SMOKE: "1", PIXIBOARD_BROWSER_SAMPLES: "5", PIXIBOARD_BROWSER_EVIDENCE: "/tmp/no.json" })).toThrow(/canonical matrix/); });
  it("fails closed for missing pairs and required observations", () => { const config = resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SMOKE: "1", PIXIBOARD_BROWSER_COUNTS: "10000", PIXIBOARD_BROWSER_MODES: "matched-visible", PIXIBOARD_BROWSER_SAMPLES: "5" }); const checks = computeFairnessChecks(config, []); expect(checks[0].pairPresent).toBe(false); expect(validateBrowserObservations(config, [], checks)).toEqual(expect.arrayContaining(["case count mismatch", "matched-visible/10000: fairness failed"])); });
  it.skipIf(process.env.PIXIBOARD_BROWSER_INTEGRATION !== "1")("runs the real Chromium smoke contract", async () => {
    const output = `${process.cwd()}/results/.tmp-browser-smoke-${Date.now()}.json`;
    const { report } = await runBrowserBenchmark(resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SMOKE: "1", PIXIBOARD_BROWSER_COUNTS: "10000", PIXIBOARD_BROWSER_MODES: "matched-visible", PIXIBOARD_BROWSER_SAMPLES: "5", PIXIBOARD_BROWSER_WARMUP: "2", PIXIBOARD_BROWSER_OUTPUT: output }));
    expect(report.runKind).toBe("smoke");
    expect(report.publishable).toBe(false);
    expect(report.validation.passed).toBe(true);
    expect(report.observations).toHaveLength(2);
    expect(report.observations.map((item) => item.renderer.observed).sort()).toEqual(["canvas2d", "webgl"]);
  }, 120_000);
});
