import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    browser: "src/browser.ts",
    node: "src/node.ts",
    types: "src/types.ts",
    core: "src/subpaths/core.ts",
    capabilities: "src/subpaths/capabilities.ts",
    "agent-tools": "src/subpaths/agent-tools.ts",
    "agent-tools-schemas": "src/subpaths/agent-tools-schemas.ts",
    plugin: "src/subpaths/plugin.ts",
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
  // Entries share one chunk for bundled internals; public core/capabilities
  // stay external so every entry and direct core imports use one instance.
  splitting: true,
  treeshake: true,
  minify: false,
  esbuildOptions(options) {
    options.alias = {
      "@pixi-board/adapter-browser": "../adapter-browser/src/index.ts",
      "@pixi-board/agent-tools/schemas": "../agent-tools/src/schemas.ts",
      "@pixi-board/agent-tools": "../agent-tools/src/index.ts",
      "@pixi-board/capabilities": "../capabilities/src/index.ts",
      "@pixi-board/core": "../core/src/index.ts",
      "@pixi-board/plugin-sdk": "../plugin-sdk/src/index.ts",
      "@pixi-board/renderer-pixi": "../renderer-pixi/src/index.ts",
    };
  },
});
