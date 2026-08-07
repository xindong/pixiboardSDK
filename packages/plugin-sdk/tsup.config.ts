import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  dts: true,
  tsconfig: "tsconfig.build.json",
  sourcemap: true,
  clean: true,
  splitting: false,
  esbuildOptions(options) {
    options.alias = {
      "@pixi-board/plugin-api-v3": "../plugin-api-v3/src/index.ts",
      "@pixi-board/capabilities": "../capabilities/src/index.ts",
      "@pixi-board/core": "../core/src/index.ts"
    };
  }
});
