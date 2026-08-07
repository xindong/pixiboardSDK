import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
