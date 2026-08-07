import { createPixiBoardBenchmarkAdapter } from "./adapter";
import type { HarnessOptions } from "./harness";

export type BenchmarkRunOptions = HarnessOptions & { reportPath?: string };

/** Public runner entrypoint; execution is independent of Vitest assertions. */
export async function runBenchmark(options: BenchmarkRunOptions = {}) {
  return createPixiBoardBenchmarkAdapter().run(options);
}
