import { resolve } from "node:path";

export default {
  resolve: {
    alias: {
      "@pixi-board/core": resolve(process.cwd(), "packages/core/src/index.ts"),
      "@pixi-board/capabilities": resolve(process.cwd(), "packages/capabilities/src/index.ts"),
    },
  },
  test: { include: ["packages/plugin-api-v3/src/**/*.test.ts"] },
};
