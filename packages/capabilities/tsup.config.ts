import { defineConfig } from "tsup";

// Workspace dependencies stay external on purpose: bundling @pixi-board/core
// in here would ship a second copy of its error classes alongside the one the
// published core package already provides.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  dts: { compilerOptions: { allowImportingTsExtensions: true } },
  sourcemap: true,
  clean: true,
  splitting: false,
});
