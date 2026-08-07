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
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "playwright", "test", "--config", "tests/browser/playwright.config.ts"],
    { stdio: "inherit", env: process.env },
  );
  child.on("exit", (code, signal) => {
    process.exitCode = signal === null ? (code ?? 1) : 1;
  });
  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
