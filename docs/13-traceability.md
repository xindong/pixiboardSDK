# 目标追踪矩阵

## 产品目标到设计与验收

| 目标 | 设计文档 | 主要迁移来源 | 验收位置 |
|---|---|---|---|
| 扁平文档 | [目标架构](02-target-architecture.md) | `board-domain/types.ts` | P1 core、新 Document schema fixture |
| 仅支持 SDK 新 Document | [ADR 0011](adr/0011-new-document-format-only.md) | 新 Core validation boundary；无 legacy adapter | current-format load/save/reload + legacy/non-current rejection tests + requirement audit |
| 数据为真相 | [ADR 0002](adr/0002-document-source-pixi-cache.md) | Store/Scene/ViewRegistry | 离屏销毁重建测试 |
| 自定义节点 | [自定义节点](05-custom-node-system.md) | `nodeView.ts`、domain union | custom task-card E2E |
| 高性能稀疏画布 | [性能基准](10-performance-benchmarks.md) | `GridSpatialIndex`、View cache、TextureCache | 10k/50k/100k benchmark |
| 一个主要用户包并公开 Core | [包边界](03-package-boundaries.md) | workspace packages | Main/Core npm external consumers |
| Desktop/Web 共用 | [平台适配](07-platform-assets-persistence.md) | runtime adapter/repositories | Browser/Tauri contract tests |
| 插件化 | [插件与 Agent](06-capabilities-plugins-agents.md) | new plugin SDK/tool runtime/host | new Plugin API v3 fixture; legacy plugin deprecation |
| Agent 核心能力 | [插件与 Agent](06-capabilities-plugins-agents.md) | canvas plugin/MCP host | direct vs MCP equivalence |
| Desktop 渐进接入 | [迁移计划](08-migration-plan.md) | `MediaWhiteboard` composition | SDK 新格式 desktop parity gates；旧项目不进入 SDK |
| 稳定公开 API | [公共 API](04-public-api.md) | 新 facade | API report/semver |

## 当前热点文件追踪

| 源文件 | 问题 | 目标处理 | 阶段 |
|---|---|---|---|
| `whiteboard.ts` | 组合职责过重 | 拆 runtime facade 与 desktop wiring | M3/M5 |
| `boardStore.ts` | 可变引用、O(N) 热点、type/asset 耦合 | core indexed store | M1 |
| `boardScenePatch.ts` | renderer 命名、事件字段不足 | canonical ChangeSet | M1 |
| `nodeView.ts` | 内置分支硬编码 | built-in renderers via registry | M2 |
| `boardInteractionController.ts` | window 全局监听 | scoped interaction runtime | M3 |
| `boardWriteService.ts` | UI/Scene/persistence/asset 混合 | BoardCapabilities services | M4 |
| `boardRepository.ts` | 平台能力过宽 | narrow ports | M4/M6 |
| `browserBoardRepository.ts` | 非完整 Web 实现 | browser persistence/assets | M6 |
| `pluginRuntimeHost.ts` | 依赖 MediaWhiteboard/Tauri | capability consumer + loader | M5/M7 |
| `board-plugin-canvas` | 重复 query/write 逻辑 | thin Agent adapter | M7 |
| `tauriMcpToolHost.ts` | transport 与 app wiring | MCP host adapter | M7 |

## 规划交付覆盖检查

- 产品范围：[00-product-goals.md](00-product-goals.md)
- 现有代码依据：[01-current-state.md](01-current-state.md)
- 目标架构：[02-target-architecture.md](02-target-architecture.md)
- 包结构：[03-package-boundaries.md](03-package-boundaries.md)
- API：[04-public-api.md](04-public-api.md)
- 自定义节点：[05-custom-node-system.md](05-custom-node-system.md)
- 插件/Agent：[06-capabilities-plugins-agents.md](06-capabilities-plugins-agents.md)
- Web/Tauri：[07-platform-assets-persistence.md](07-platform-assets-persistence.md)
- 文件迁移：[08-migration-plan.md](08-migration-plan.md)
- 阶段交付：[09-delivery-roadmap.md](09-delivery-roadmap.md)
- 性能：[10-performance-benchmarks.md](10-performance-benchmarks.md)
- 测试发布：[11-testing-release-compatibility.md](11-testing-release-compatibility.md)
- 风险决策：[12-risks-open-decisions.md](12-risks-open-decisions.md)
- Document 格式决策：[adr/0011-new-document-format-only.md](adr/0011-new-document-format-only.md)
