import { defineConfig } from "tsup";

// Workspace dependencies stay external on purpose: bundling
// @pixi-board/capabilities here would ship a second CapabilityError class, and
// error identity across the two copies would depend entirely on the brand
// check in isCapabilityError().
export default defineConfig({
  entry: { index: "src/index.ts", schemas: "src/schemas.ts" },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  dts: { compilerOptions: { allowImportingTsExtensions: true } },
  sourcemap: true,
  clean: true,
  splitting: false,
});
