import { describe, expect, it } from "vitest";
import { BROWSER_BENCHMARK_DEFAULTS, resolveBrowserBenchmarkConfig } from "../src/browser-runner.mjs";
describe("real browser benchmark contract", () => {
  it("keeps the canonical matrix fixed", () => { expect(BROWSER_BENCHMARK_DEFAULTS).toMatchObject({ counts: [10_000, 50_000, 100_000], modes: ["matched-visible", "full-retained"], engines: ["pixiboardjs", "konva"], viewport: { width: 1920, height: 1080 }, dpr: 1, seed: 42, warmupFrames: 30, sampleFrames: 120 }); });
  it("separates smoke from canonical evidence", () => { expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_COUNTS: "1000" })).toThrow(/10000/); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_COUNTS: "," })).toThrow(/empty/); expect(resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SMOKE: "1", PIXIBOARD_BROWSER_SAMPLES: "5" })).toMatchObject({ smoke: true, canonical: false, sampleFrames: 5 }); expect(() => resolveBrowserBenchmarkConfig({ PIXIBOARD_BROWSER_SMOKE: "1", PIXIBOARD_BROWSER_SAMPLES: "5", PIXIBOARD_BROWSER_EVIDENCE: "/tmp/no.json" })).toThrow(/canonical matrix/); });
});
