import { resolve } from "node:path";

const packageRoot = import.meta.dirname;

export default {
  resolve: {
    alias: {
      "@pixi-board/core": resolve(packageRoot, "../core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
};
