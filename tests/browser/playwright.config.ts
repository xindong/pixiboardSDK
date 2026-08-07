import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4178",
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
    command: "pnpm --dir apps/examples-vanilla exec vite --host 127.0.0.1 --port 4178",
    cwd: resolve(import.meta.dirname, "../.."),
    port: 4178,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
