# P6 Release Gate

仓库根目录的 `pnpm release:check` 是不生成构建产物的重复检查。它不会转译源码或运行 TypeScript 类型检查；若真实 `dist/` 尚未由 `pnpm build:release` 生成，会在 pack 前明确列出缺失产物并失败。

脚本从三个 public packages 执行真实的 `pnpm pack`，解开 tarball 后验证：

- packed manifest 不含 `workspace:*`；主包将私有 workspace 实现打入产物，registry runtime dependency 仅保留 `pixi.js`。
- runtime exports 指向可由声明支持的 Node 20 和浏览器直接加载的 JavaScript，而不是仓库内的原始 TypeScript。
- 仅供内部使用的 adapter、capabilities、renderer 和 `plugin-api-v3` 不作为 registry dependency 泄漏；版本门禁只覆盖 public tarball 及其 runtime dependency graph。
- export target 必须实际存在于 tarball。
- 以上条件满足后，才把 tarball 安装到仓库外临时 Node/Vite fixture 并执行导入与最小运行，再检查 API report 和 bundle budget。

P6 配置使用 tsup 生成可重复的 ESM JavaScript、source map 和 `.d.ts`，Changesets 固定管理三个 public package，API Extractor 在真实 dist 上以 production mode 对 committed report 做 diff，独立 JSON 文件定义三个包的 bundle budget。仓库不提交 `dist/`；`pnpm build:release` 生成真实产物后，`pnpm release:check` 必须完成仓库外 Node import、声明解析和 Vite production build。

ADR 0010 要求公开 `@pixi-board/plugin-sdk`。本提交新增只暴露 v3 contract 的 public facade；packaged host 和 loader 继续留在私有的 `@pixi-board/plugin-api-v3`，避免与 host session 的实现边界冲突。
