# ADR 0007：Renderer 后端、Pixi 依赖和 Escape Hatch

- Status: Accepted
- Date: 2026-08-07

## Decision

- SDK v1 正式支持 WebGL renderer；WebGPU 作为 1.0 之后的 experimental backend，不阻塞 v1。
- `pixiboardjs` 锁定并安装单一 PixiJS 版本；内部 `renderer-pixi` 不要求普通用户额外安装 Pixi。
- 不公开全局 Pixi Application、Stage、worldLayer 或 TextureCache。
- 自定义节点只能通过受控 `PixiNodeRendererContext` 使用 Pixi 和资产 lease。
- 提供只读 diagnostics，不提供可破坏虚拟化和生命周期的全局 renderer escape hatch。
- 静态画布按需渲染；只有交互、视频或注册动画活跃时运行连续帧。
- Document commit 发 `change`；renderer 应用对应 revision 并完成 render pass 后另发 `render:complete`。

## Consequences

- 首发后端稳定、测试范围可控。
- 避免多份 Pixi runtime 和插件直接修改 Scene。
- 高级用户仍能通过自定义节点实现复杂 Pixi 内容，但必须遵守 View 可销毁原则。
