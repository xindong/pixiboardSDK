import { resolve } from "node:path";

export default {
  resolve: {
    alias: {
      "@pixi-board/core": resolve(process.cwd(), "packages/core/src/index.ts"),
      "@pixi-board/capabilities": resolve(process.cwd(), "packages/capabilities/src/index.ts"),
      "@pixi-board/agent-tools": resolve(process.cwd(), "packages/agent-tools/src/index.ts"),
      "@pixi-board/plugin-api-v3": resolve(process.cwd(), "packages/plugin-api-v3/src/index.ts"),
      "@pixi-board/renderer-pixi": resolve(process.cwd(), "packages/renderer-pixi/src/index.ts"),
      pixiboardjs: resolve(process.cwd(), "packages/pixiboardjs/src/index.ts"),
    },
  },
  test: { include: ["apps/examples-desktop-sdk/test/**/*.test.ts"] },
};
