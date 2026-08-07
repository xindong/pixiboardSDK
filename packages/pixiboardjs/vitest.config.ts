import { resolve } from "node:path";

export default {
  resolve: {
    alias: {
      "@pixi-board/core": resolve(process.cwd(), "packages/core/src/index.ts"),
      "@pixi-board/renderer-pixi": resolve(process.cwd(), "packages/renderer-pixi/src/index.ts"),
      "@pixi-board/capabilities": resolve(process.cwd(), "packages/capabilities/src/index.ts"),
      "@pixi-board/adapter-browser": resolve(process.cwd(), "packages/adapter-browser/src/index.ts"),
    },
  },
  test: { environment: "node", include: ["packages/pixiboardjs/test/**/*.test.ts"] },
};

