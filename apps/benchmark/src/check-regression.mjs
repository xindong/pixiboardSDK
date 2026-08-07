import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareBenchmarkReports, DEFAULT_REGRESSION_TOLERANCE } from "./regression.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--allow-environment-mismatch") {
    args.set(argument, true);
  } else if (argument.startsWith("--")) {
    args.set(argument, process.argv[++index]);
  }
}

const baselinePath = args.get("--baseline");
const candidatePath = args.get("--candidate");
if (typeof baselinePath !== "string" || typeof candidatePath !== "string") {
  console.error("Usage: node src/check-regression.mjs --baseline <report.json> --candidate <report.json> [--tolerance 0.1] [--allow-environment-mismatch]");
  process.exitCode = 2;
} else {
  const [baseline, candidate] = await Promise.all([
    readFile(resolve(process.cwd(), baselinePath), "utf8").then(JSON.parse),
    readFile(resolve(process.cwd(), candidatePath), "utf8").then(JSON.parse),
  ]);
  const tolerance = Number(args.get("--tolerance") ?? DEFAULT_REGRESSION_TOLERANCE);
  const result = compareBenchmarkReports(baseline, candidate, {
    tolerance,
    allowEnvironmentMismatch: args.has("--allow-environment-mismatch"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
