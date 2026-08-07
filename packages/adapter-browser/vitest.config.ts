import { resolve } from "node:path";

export default {
  resolve: {
    alias: {
      "@pixi-board/core": resolve(process.cwd(), "packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/adapter-browser/test/**/*.test.ts"],
  },
};
