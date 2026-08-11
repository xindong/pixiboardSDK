import { spawn } from "node:child_process";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/run-core-gate.mjs");
  process.exit(0);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commands = [
  ["docs:check"],
  ["packages:check"],
  ["exec", "node", "scripts/check-current-document-only.mjs"],
  ["exec", "node", "--test", "scripts/check-current-document-only.test.mjs"],
  ["--filter", "@pixi-board/core", "test"],
  ["--filter", "@pixi-board/renderer-pixi", "test"],
  ["--filter", "@pixi-board/capabilities", "test"],
  ["--filter", "@pixi-board/agent-tools", "test"],
  ["--filter", "@pixi-board/core", "build"],
  ["--filter", "@pixi-board/plugin-api-v3", "test"],
  ["--filter", "@pixi-board/adapter-contract-tests", "test"],
  ["--filter", "@pixi-board/adapter-browser", "test"],
  ["--filter", "@pixi-board/adapter-tauri", "test"],
  ["--filter", "pixiboardjs", "test"],
];

const failures = [];
for (const args of commands) {
  console.log(`\n[core gate] pnpm ${args.join(" ")}`);
  const code = await run(pnpm, args);
  if (code !== 0) failures.push(`pnpm ${args.join(" ")} (exit ${code})`);
}

if (failures.length) {
  console.error("\nCore contract gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else console.log("\nCore contract gate passed: document boundary, package boundary and all contract suites executed.");

function run(command, args) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", (error) => { console.error(error); resolveExit(1); });
    child.on("exit", (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
  });
}
