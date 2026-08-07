# ADR 0002：Document 是事实，Pixi Scene 是缓存

- Status: Accepted
- Date: 2026-08-07

## Context

大型画布无法让每个文档节点永久对应一个活跃 Pixi DisplayObject 和纹理。现有项目已经通过 RBush、NodeViewRegistry 和 TextureCache 实现视口虚拟化。

## Decision

- 所有持久业务状态必须存在于可序列化 `BoardDocument` 和 Asset records。
- Pixi View、Texture、HTMLMediaElement、hover 和动画进度是可丢弃 runtime state。
- Renderer 只读 document snapshot/change event，不允许修改 Store。
- View 必须可以在离屏销毁后，仅凭最新 node JSON、registered renderer 和 assets 重建。
- 外部 SDK 用户不能直接持久化或持有内部 DisplayObject 作为状态来源。

## Consequences

收益：

- 文档总节点数与活跃渲染对象数解耦。
- Renderer reload、context loss 和离屏回收可恢复。
- Headless Core 和 Agent 文档操作成为可能。

代价：

- 自定义 renderer 必须严格区分业务状态和 View 状态。
- 异步资源加载需要 generation/AbortSignal 防止迟到更新。
- capture、hit test 等能力需要 mounted renderer。

