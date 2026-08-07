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
      "@pixi-board/plugin-sdk": resolve(root, "packages/plugin-sdk/src/index.ts"),
    },
  },
  test: { include: ["packages/plugin-api-v3/src/**/*.test.ts"] },
};
