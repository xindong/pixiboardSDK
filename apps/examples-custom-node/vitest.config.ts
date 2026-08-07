import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: {
      pixiboardjs: resolve(root, "packages/pixiboardjs/src/index.ts"),
      "@pixi-board/core": resolve(root, "packages/core/src/index.ts"),
      "@pixi-board/capabilities": resolve(root, "packages/capabilities/src/index.ts"),
      "@pixi-board/adapter-browser": resolve(root, "packages/adapter-browser/src/index.ts"),
      "@pixi-board/renderer-pixi": resolve(root, "packages/renderer-pixi/src/index.ts"),
    },
  },
  test: { environment: "node" },
});
