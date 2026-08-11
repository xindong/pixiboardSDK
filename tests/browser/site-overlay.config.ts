import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Drives the live demo (apps/site) rather than the vanilla consumer fixture,
 * so the SDK's selection and label overlays are exercised through the same
 * code path the published demo runs.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "site-overlay.spec.ts",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4180",
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: {
        args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
      },
    },
  }],
  webServer: {
    command: "pnpm --dir apps/site exec vite --host 127.0.0.1 --port 4180",
    cwd: resolve(import.meta.dirname, "../.."),
    port: 4180,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
