import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    browser: "src/browser.ts",
    node: "src/node.ts",
    types: "src/types.ts",
  },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  dts: {
    compilerOptions: {
      allowImportingTsExtensions: true,
      noCheck: true,
    },
  },
  tsconfig: "tsconfig.build.json",
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  esbuildOptions(options) {
    options.alias = {
      "@pixi-board/adapter-browser": "../adapter-browser/src/index.ts",
      "@pixi-board/capabilities": "../capabilities/src/index.ts",
      "@pixi-board/core": "../core/src/index.ts",
      "@pixi-board/renderer-pixi": "../renderer-pixi/src/index.ts",
    };
  },
});
