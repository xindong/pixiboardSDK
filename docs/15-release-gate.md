# P6 Release Gate

干净 checkout 的发布候选必须按顺序执行：

```text
pnpm install --frozen-lockfile
pnpm build:release
pnpm release:check
```

`pnpm release:check` 不隐式构建，也不接受缺失或陈旧的 `dist/`。它对 `pixiboardjs`、`@pixi-board/core`、`@pixi-board/plugin-sdk` 执行真实 `pnpm pack`，拒绝 `workspace:*`、私有 workspace dependency、缺失 export target 和非 JavaScript runtime export。

三份 tarball 随后同时安装到仓库外临时 consumer。该 consumer 执行所有公开 subpath 的 Node import、严格模式外部 TypeScript 编译和 Vite production build；这同时验证三包声明文件可由 registry consumer 使用，且不会泄漏私有 adapter、capabilities、renderer 或 plugin host 类型。

同一 gate 运行 API Extractor production compare，并检查三个公开包各自的 bundle budget。设置以下变量时，CI 会保留可审计输出：

- `PIXIBOARD_RELEASE_ARTIFACT_DIR=.artifacts/release`：保存 `tarballs/` 下三份 `.tgz`、`api-reports/` 下三份正确的 committed API report，以及 `release-manifest.json`。
- `PIXIBOARD_BUNDLE_REPORT=.artifacts/release/bundle-report.json`：保存每个受预算约束文件的真实字节数、上限和通过状态。

仓库仍不提交 `dist/`、tarball 或临时 consumer。Changesets 只管理三个公开包；`@pixi-board/plugin-sdk` 只暴露 v3 contract，私有 packaged host/loader 不进入 public registry dependency graph。旧插件不迁移、不兼容、也不重新打包。
