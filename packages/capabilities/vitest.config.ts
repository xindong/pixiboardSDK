import { resolve } from "node:path";

export default {
  resolve: { alias: { "@pixi-board/core": resolve(process.cwd(), "packages/core/src/index.ts") } },
  test: { include: ["packages/capabilities/src/**/*.test.ts"] },
};
