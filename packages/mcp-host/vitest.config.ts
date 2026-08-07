import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default {
  root,
  resolve: {
    alias: {
      "@pixi-board/core": resolve(root, "packages/core/src/index.ts"),
      "@pixi-board/capabilities": resolve(root, "packages/capabilities/src/index.ts"),
      "@pixi-board/agent-tools": resolve(root, "packages/agent-tools/src/index.ts"),
      "pixiboardjs": resolve(root, "packages/pixiboardjs/src/index.ts"),
      "@pixi-board/renderer-pixi": resolve(root, "packages/renderer-pixi/src/index.ts"),
      "@pixi-board/adapter-browser": resolve(root, "packages/adapter-browser/src/index.ts"),
    },
  },
  test: { include: ["packages/mcp-host/src/**/*.test.ts"] },
};
