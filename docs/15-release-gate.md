# P6 Release Gate

仓库根目录的 `pnpm release:check` 是不依赖构建的重复检查。它不生成 `dist/`、不转译源码，也不运行 TypeScript 类型检查。

脚本从 `packages/pixiboardjs` 执行真实的 `pnpm pack`，解开 tarball 后验证：

- packed manifest 不含 `workspace:*`；pnpm 必须把源码 workspace 协议改写为普通版本。
- runtime exports 指向可由声明支持的 Node 20 和浏览器直接加载的 JavaScript，而不是仓库内的原始 TypeScript。
- 仅供内部使用的 adapter、capabilities 和 renderer 不作为 registry dependency 泄漏；公开依赖使用非占位版本。
- 以上条件满足后，才把 tarball 安装到仓库外临时 Node/Vite fixture 并执行导入与最小运行。

当前 `3d3c58c` facade 的真实 tarball 可以生成，且 pnpm 会把 `workspace:*` 改写为 `0.0.0`。但发布仍被阻塞：exports 指向 `src/*.ts`；adapter-browser、capabilities、renderer-pixi 仍是内部包；所有 workspace 依赖仍是占位版本 `0.0.0`。因此 gate 必须失败，不能宣称 external consumer 已通过。后续需要正式的轻量 transpile/bundle/staging 流程，或通过新的发布决策显式公开并版本化依赖。
