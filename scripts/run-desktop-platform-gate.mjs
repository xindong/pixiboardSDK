import { spawn } from "node:child_process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const mode = args.get("--mode");
const platform = process.env.PIXIBOARD_DESKTOP_PLATFORM ?? process.platform;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const manifest = "apps/examples-desktop-sdk/src-tauri/Cargo.toml";

if (mode === "headless") {
  console.log(`Running the desktop host contract on ${platform}. This is a headless MemoryTauri fixture, not a Tauri launch smoke.`);
  process.exitCode = await prepareAndRun(["--filter", "pixiboardjs-example-desktop-sdk", "test"]);
} else if (mode === "tauri") {
  const prepareCode = await prepareRuntimeArtifacts();
  if (prepareCode !== 0) {
    process.exitCode = prepareCode;
  } else {
    const testCode = await run("cargo", ["test", "--manifest-path", manifest, "--locked"], process.cwd(), false);
    if (testCode !== 0) process.exitCode = testCode;
    else if (process.platform === "darwin") {
      console.log("Running the repository's real macOS Tauri launch smoke (--smoke).");
      process.exitCode = await run("cargo", ["run", "--manifest-path", manifest, "--locked", "--", "--smoke"], process.cwd(), false);
    } else if (process.platform === "win32") {
      console.log("Running the repository's real Windows Tauri native release build/config evidence.");
      process.exitCode = await run("cargo", ["build", "--manifest-path", manifest, "--release", "--locked"], process.cwd(), false);
    } else {
      throw new Error(`Tauri platform gate is only defined for macOS and Windows, received ${process.platform}`);
    }
  }
} else {
  throw new Error("Expected --mode headless or --mode tauri");
}

async function prepareAndRun(commandArgs) {
  const prepareCode = await prepareRuntimeArtifacts();
  return prepareCode === 0 ? run(pnpm, commandArgs, process.cwd(), false) : prepareCode;
}

async function prepareRuntimeArtifacts() {
  // Child processes and the public plugin package resolve release-style package exports.
  for (const packageName of ["@pixi-board/core", "@pixi-board/plugin-sdk"]) {
    const code = await run(pnpm, ["--filter", packageName, "build"], process.cwd(), false);
    if (code !== 0) return code;
  }
  return 0;
}

function run(command, commandArgs, cwd, shell) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd, shell, stdio: "inherit", env: process.env });
    child.on("error", (error) => { console.error(error); resolve(1); });
    child.on("exit", (code, signal) => resolve(signal === null ? (code ?? 1) : 1));
  });
}
