import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default {
  root,
  resolve: {
    alias: {
      "@pixi-board/core": resolve(root, "packages/core/src/index.ts"),
      "@pixi-board/renderer-pixi": resolve(root, "packages/renderer-pixi/src/index.ts"),
      "@pixi-board/capabilities": resolve(root, "packages/capabilities/src/index.ts"),
      "@pixi-board/adapter-browser": resolve(root, "packages/adapter-browser/src/index.ts"),
    },
  },
  test: { environment: "node", include: ["packages/pixiboardjs/test/**/*.test.ts"] },
};
