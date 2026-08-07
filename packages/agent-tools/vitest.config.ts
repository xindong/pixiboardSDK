import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default {
  root,
  resolve: {
    alias: {
      "@pixi-board/core": resolve(root, "packages/core/src/index.ts"),
      "@pixi-board/capabilities": resolve(root, "packages/capabilities/src/index.ts"),
    },
  },
  test: { include: ["packages/agent-tools/src/**/*.test.ts"] },
};
