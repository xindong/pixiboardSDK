import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runDeterministicBenchmark, type HarnessOptions } from "./harness";

export type RealBenchmarkAdapter = {
  readonly name: "pixiboardjs-core-renderer";
  run(options?: HarnessOptions & { reportPath?: string }): Promise<Awaited<ReturnType<typeof runDeterministicBenchmark>>>;
};

/** Executes the real BoardCore, spatial, renderer and facade operations. */
export function createPixiBoardBenchmarkAdapter(): RealBenchmarkAdapter {
  return {
    name: "pixiboardjs-core-renderer",
    async run(options = {}) {
      const { reportPath, ...harnessOptions } = options;
      const report = await runDeterministicBenchmark(harnessOptions);
      if (reportPath) {
        const destination = resolve(process.cwd(), reportPath);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      return report;
    },
  };
}
