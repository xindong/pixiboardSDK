import { accessSync, constants } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const executable = chromium.executablePath();
let browserAvailable = true;
try {
  accessSync(executable, constants.X_OK);
} catch {
  browserAvailable = false;
}

if (!browserAvailable) {
  console.warn([
    `SKIP browser contract: Playwright Chromium is not installed at ${executable}`,
    "Install it with: pnpm exec playwright install chromium",
    "Set PIXIBOARD_REQUIRE_BROWSER=1 (or run in CI) to turn this skip into a failure.",
  ].join("\n"));
  if (process.env.PIXIBOARD_REQUIRE_BROWSER === "1" || process.env.CI) process.exitCode = 1;
} else {
  // Two suites, two servers: the contract suite drives the vanilla consumer
  // fixture (the public install path), while the overlay suite drives the live
  // demo, which is the only place the SDK's selection/label overlays are wired
  // the way a real host wires them.
  const configs = [
    "tests/browser/playwright.config.ts",
    "tests/browser/site-overlay.config.ts",
  ];
  let failed = false;
  for (const config of configs) {
    const code = await new Promise((resolve) => {
      const child = spawn(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["exec", "playwright", "test", "--config", config],
        { stdio: "inherit", env: process.env },
      );
      child.on("exit", (exitCode, signal) => resolve(signal === null ? (exitCode ?? 1) : 1));
      child.on("error", (error) => { console.error(error); resolve(1); });
    });
    if (code !== 0) failed = true;
  }
  if (failed) process.exitCode = 1;
}
