# P6 Release Gate

仓库根目录的 `pnpm release:check` 是不生成构建产物的重复检查。它不会转译源码或运行 TypeScript 类型检查；若真实 `dist/` 尚未由 `pnpm build:release` 生成，会在 pack 前明确列出缺失产物并失败。

脚本从 `packages/pixiboardjs` 执行真实的 `pnpm pack`，解开 tarball 后验证：

- packed manifest 不含 `workspace:*`；主包将私有 workspace 实现打入产物，registry runtime dependency 仅保留 `pixi.js`。
- runtime exports 指向可由声明支持的 Node 20 和浏览器直接加载的 JavaScript，而不是仓库内的原始 TypeScript。
- 仅供内部使用的 adapter、capabilities 和 renderer 不作为 registry dependency 泄漏；所有 workspace 包采用 alpha train 的非 `0.0.0` 版本。
- export target 必须实际存在于 tarball。
- 以上条件满足后，才把 tarball 安装到仓库外临时 Node/Vite fixture 并执行导入与最小运行，再检查 API report 和 bundle budget。

P6 配置使用 tsup 生成可重复的 ESM JavaScript、source map 和 `.d.ts`，Changesets 管理主包与公开 Core 的 fixed version，API Extractor 维护批准的 API report，独立 JSON 文件定义 bundle budget。仓库不提交手写 `dist/`；在本 session 未运行 build/typecheck 的约束下，真实产物、API report 以及仓库外 Node/Vite consumer 验证保留为明确 blocker。

ADR 0010 还要求公开 `@pixi-board/plugin-sdk`。现有包名为私有的 `@pixi-board/plugin-api-v3`，本次不擅自将其视为同一公共契约；正式命名和迁移仍需后续实现。
