import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(packageRoot, "../..");

export default {
  root: repoRoot,
  resolve: {
    alias: {
      "@pixi-board/core": resolve(repoRoot, "packages/core/src/index.ts"),
      "@pixi-board/capabilities": resolve(repoRoot, "packages/capabilities/src/index.ts"),
      "@pixi-board/agent-tools": resolve(repoRoot, "packages/agent-tools/src/index.ts"),
      "@pixi-board/plugin-api-v3": resolve(repoRoot, "packages/plugin-api-v3/src/index.ts"),
      "@pixi-board/renderer-pixi": resolve(repoRoot, "packages/renderer-pixi/src/index.ts"),
      "@pixi-board/adapter-tauri": resolve(repoRoot, "packages/adapter-tauri/src/index.ts"),
      // Subpaths must come before the bare "pixiboardjs" alias, which would otherwise prefix-match them.
      "pixiboardjs/core": resolve(repoRoot, "packages/pixiboardjs/src/subpaths/core.ts"),
      "pixiboardjs/capabilities": resolve(repoRoot, "packages/pixiboardjs/src/subpaths/capabilities.ts"),
      "pixiboardjs/agent-tools": resolve(repoRoot, "packages/pixiboardjs/src/subpaths/agent-tools.ts"),
      pixiboardjs: resolve(repoRoot, "packages/pixiboardjs/src/index.ts"),
    },
  },
  test: { include: ["apps/examples-desktop-sdk/test/**/*.test.ts"] },
};
