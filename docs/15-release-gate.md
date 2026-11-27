# P6 Release Gate

干净 checkout 的发布候选必须按顺序执行：

```text
pnpm install --frozen-lockfile
pnpm build:release
pnpm release:check
```

`pnpm release:check` 不隐式构建，也不接受缺失或陈旧的 `dist/`。它对唯一的公开包 `pixiboardjs`（[ADR 0016](adr/0016-single-public-package-subpaths.md)）执行真实 `pnpm pack`，拒绝 `workspace:*`、私有 workspace dependency、缺失 export target 和非 JavaScript runtime export。

这份 tarball 随后与 `scripts/build-legacy-shims.mjs` 生成的 4 个旧包名转发包一起安装到仓库外临时 consumer。该 consumer 执行所有公开 subpath 的 Node import、严格模式外部 TypeScript 编译和 Vite production build；这同时验证声明文件可由 registry consumer 使用、不引用任何 `@pixi-board/*` 私有包，且所有子路径和旧包名都拿到同一份 core 与 capabilities 实例。

同一 gate 运行所有公开入口的 API Extractor production compare（共九份 API report），并检查主包各入口与共享 chunk 的 bundle budget，以及 core、capabilities 在 dist 中只定义一次。设置以下变量时，CI 会保留可审计输出：

- `PIXIBOARD_RELEASE_ARTIFACT_DIR=.artifacts/release`：保存 `tarballs/` 下主包 `.tgz`、`legacy-shims/` 下 4 份旧包名转发包、`api-reports/` 下九份正确的 committed API report，以及 `release-manifest.json`。
- `PIXIBOARD_BUNDLE_REPORT=.artifacts/release/bundle-report.json`：保存每个受预算约束文件的真实字节数、上限和通过状态。

仓库仍不提交 `dist/`、tarball 或临时 consumer。Changesets 的 fixed 版本组里只有 `pixiboardjs` 会发布，其余私有包只随之记版本；`pixiboardjs/plugin` 只暴露 v3 contract，私有 packaged host/loader 不进入 public registry dependency graph。旧插件不迁移、不兼容、也不重新打包。
