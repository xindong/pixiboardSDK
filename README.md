# PixiBoardJS SDK

PixiBoardJS 是一个面向大型媒体工作流的高性能无限画布 SDK 规划项目。它从现有 `pixi-board` 桌面应用中提炼可复用的画布内核、Pixi 渲染器、统一读写能力以及 Web/Tauri 适配边界。

当前仓库处于 **架构与交付计划阶段**。本阶段的目标不是复制 Konva 的通用场景树，而是交付一个扁平节点、数据驱动、支持自定义节点、插件和 Agent 的媒体画布 SDK。

## 核心定位

- 对 SDK 使用者只提供一个主包：`pixiboardjs`。
- 内部保持 `core`、`renderer-pixi`、`capabilities` 和平台适配器的清晰边界。
- 文档数据是唯一事实来源，Pixi Scene 是可销毁、可重建的视口缓存。
- 文档模型保持扁平，不提供通用 `Group/Layer/children` 场景树。
- 内置节点和用户自定义节点统一通过 Node Type Registry 注册。
- 产品 UI、插件宿主、Agent 工具和 MCP 传输位于 SDK 之上。

## 文档入口

- [文档总览](docs/README.md)
- [产品目标与范围](docs/00-product-goals.md)
- [当前代码评估](docs/01-current-state.md)
- [目标技术架构](docs/02-target-architecture.md)
- [包与模块边界](docs/03-package-boundaries.md)
- [公共 API 设计](docs/04-public-api.md)
- [自定义节点系统](docs/05-custom-node-system.md)
- [Capabilities、插件与 Agent](docs/06-capabilities-plugins-agents.md)
- [平台、资产与持久化](docs/07-platform-assets-persistence.md)
- [代码迁移计划](docs/08-migration-plan.md)
- [交付路线与验收](docs/09-delivery-roadmap.md)
- [性能目标与基准](docs/10-performance-benchmarks.md)
- [测试、发布与兼容策略](docs/11-testing-release-compatibility.md)
- [风险与已决事项](docs/12-risks-open-decisions.md)
- [目标追踪矩阵](docs/13-traceability.md)

## 事实来源

本计划以同级目录中的现有项目为迁移源：

```text
../pixi-board
```

计划基线日期：2026-08-07。
