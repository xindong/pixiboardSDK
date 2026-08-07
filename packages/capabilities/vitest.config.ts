import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default {
  root,
  resolve: { alias: { "@pixi-board/core": resolve(root, "packages/core/src/index.ts") } },
  test: { include: ["packages/capabilities/src/**/*.test.ts"] },
};
