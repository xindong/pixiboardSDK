# 风险与已决事项

## 风险登记

| 风险 | 概率 | 影响 | 预防措施 | 触发信号 | 降级方案 |
|---|---:|---:|---|---|---|
| Public Node API 过早冻结 | 中 | 高 | alpha 先内部使用；API report | NodeHandle 不断增加 escape hatch | 缩小 stable API，其余 experimental |
| 内置媒体行为迁移回归 | 中 | 高 | parity 清单、旧 fixture、分阶段 desktop 接入 | preview/playback/import 行为不同 | 暂保留旧 service adapter |
| Web 资产持久化复杂度超期 | 高 | 高 | IndexedDB+OPFS 分层、fallback、quota/GC 测试 | quota/Blob 恢复策略反复变化 | 降级到 IndexedDB Blob 或 remote adapter |
| 自定义 renderer 破坏性能 | 高 | 中高 | renderer context、diagnostics、资源 lease | active view/texture 不回落 | 标记 unsafe renderer，提供禁用/隔离策略 |
| 多实例输入串台 | 中 | 高 | focus scope 和 E2E | 两个实例同时响应快捷键 | 默认仅 focused board 开启 keyboard/clipboard |
| Plugin API 与 SDK API 重复 | 中 | 中高 | capabilities 为唯一新插件边界 | 两套 DTO/写入语义开始漂移 | 只保留新插件 API，废弃旧插件 |
| Persistence 与内存 commit 不一致 | 中 | 高 | dirty/error/flush 状态机 | 保存失败后 UI 仍显示 saved | 明确 dirty 状态，切换/退出前强制处理 |
| 未注册 node type 数据丢失 | 低 | 极高 | raw JSON 保留和 placeholder | load 后 unknown node 数量减少 | 阻断保存并保留原文件 |
| 包数量过多 | 中 | 中 | 先三个物理包，稳定后再拆 | 跨包改动和版本升级成本增加 | 合并内部 capabilities/adapters 到主包 |
| 性能营销缺乏证据 | 中 | 高 | 固定 benchmark 与 Konva 对照 | 只能展示 FPS 截图 | 只宣传架构特性，不发布比较结论 |
| TS/Rust schema 漂移 | 中 | 高 | TS canonical schema、fixture shared | 同一项目两端解释不同 | Rust 只负责 IO，schema 解析收口 TS |
| 长任务取消后迟到写入 | 中 | 高 | AbortSignal/generation token | 切换项目后旧任务写入新实例 | runtime instance ID 校验并拒绝提交 |

## 已确定默认决策

- 文档保持扁平，不做通用场景树。
- 文档是事实，Pixi Scene 是缓存。
- 内置节点和用户节点走同一 registry。
- 对普通用户只有一个主包 `pixiboardjs`。
- Plugin、Agent 和 UI 经 BoardCapabilities 写入。
- MCP 是 transport，不属于 core。
- Desktop/Web 共用 renderer；真正原生 renderer 不在 v1。
- 现有 desktop 采用渐进迁移，不做大爆炸重写。

## 已冻结实现决策

### Document 结构

- `nodes` 序列化使用数组，运行时使用 Map/index。
- 节点使用可选命名 `assetRefs`；旧 `assetId` 迁移到 `assetRefs.primary`。
- zIndex 允许重复，以序列化数组顺序稳定决胜；reorder API 负责规范化。
- selection 不进入 BoardDocument，只属于 session state。

### Core History

- History 使用可序列化 forward/inverse patches，不保存任意闭包 command。
- transient drag/resize 发 `interaction:preview`，最终 commit 才增加 revision/history。

### Renderer

- v1 正式支持 WebGL；WebGPU 在 1.0 后作为 experimental backend。
- 主包锁定单一 PixiJS 版本，普通用户不需要额外安装 renderer/Pixi。
- 不公开全局 Stage/Application escape hatch，只开放 custom node renderer context 和只读 diagnostics。

### Browser Storage

- IndexedDB 存 document、metadata、索引；OPFS 存原始媒体和 derivatives，缺失时回退 IndexedDB Blob。
- 导入资产默认复制进入管理存储；大文件外部引用作为 experimental。
- Asset GC roots 包括 document、history、jobs 和 leases；默认 quarantine 24 小时。
- Remote URL 默认缓存 metadata/preview，原始离线缓存需显式开启。

### Plugin

- 现有官方/内部插件不做迁移，随旧应用插件体系直接废弃。
- SDK 只定义面向未来新插件的 Plugin API v3，不提供 v2 兼容 adapter。
- v1 交付面向新插件的 Desktop zip loader；Web ESM loader 后续交付。
- 自定义 Pixi node renderer 需要显式 `renderer:trusted` 权限。

### Public Release

- Public beta 同时公开 `pixiboardjs`、`@pixi-board/core`、`@pixi-board/plugin-sdk`。
- Main/Core 在 1.x lockstep version；Plugin SDK 独立 major。
- v1 只提供 Vanilla 示例，React/Vue wrappers 后续交付。
- 2026-08-07 registry 查询显示 `pixiboardjs` 未被占用；实际发布预留版本后才算锁定。

## 决策流程

- 改变已接受架构原则必须新增 ADR。
- API 小节的实现细节可以在 milestone 内确认并更新对应规范文档。
- 性能阈值只能根据固定 benchmark 基线调整，并记录环境和理由。
- 如果决定扩大到场景树、协作或原生 renderer，应视为新产品阶段，不插入当前 v1 路线。
