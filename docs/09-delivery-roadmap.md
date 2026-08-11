# 交付路线与验收

## 工期基线

在单人全职、熟悉现有代码、AI 辅助开发、保持扁平模型的假设下：

| 交付层级 | 预计工作量 |
|---|---:|
| 可验证 SDK 原型 | 1–2 周 |
| 桌面应用切换为 SDK 消费者 | 3–4 周累计 |
| 完整 Web SDK | 4–6 周累计 |
| Public beta | 6–8 周累计 |
| 有稳定 API 和性能证据的 1.0 | 8–12 周累计 |

估算不是承诺日期；每个阶段只在退出条件达成后进入下一阶段。

## P0：契约和基线冻结（2–3 天）

### 交付物

- ADR 和 public API draft。
- 现有功能 parity 与 SDK Document 格式支持/拒绝矩阵。
- SDK 新格式典型媒体项目 fixtures；现有插件清单标记 deprecated，不作为 SDK 迁移输入。
- 统一基线测试命令。

### 验收

- 当前 TS 和 Rust 测试可统一执行并记录结果。
- SDK 新 Document fixture 可确定性 load/save/reload；旧 snapshot、schema-v4 和旧项目格式被明确拒绝。
- 扁平模型、单一主要用户包加公开 Core、数据为真相、capabilities 边界被接受。
- 旧应用继续管理旧数据；不存在 legacy document adapter、数据 migration 或 backup-before-migration 交付项。

### 风险门

Node、Asset、ChangeSet、transaction 和 Document 拒绝边界未冻结，不开始大规模搬包。

## P1：Headless Core（约 1 周）

### 交付物

- `@pixi-board/core`。
- document/store/editor/history/selection/viewport/events。
- current-format schema validation 和 NodeTypeRegistry 数据定义。

### 验收

- 无 DOM、Pixi、Tauri、plugin SDK import。
- CRUD、batch transaction、undo/redo、load/toJSON 确定性测试。
- 自定义无 asset 节点可以创建、校验、保存并重新加载。
- 非当前 schemaVersion/typeVersion、旧 `assetId` 和 legacy document shape 有明确拒绝测试。

## P2：Pixi Renderer 与自定义节点（1–1.5 周）

### 交付物

- `@pixi-board/renderer-pixi`。
- renderer registry、scene、spatial、view/texture lifecycle、capture。
- 内置节点 registry。
- custom task-card example。

### 验收

- 自定义节点离屏销毁、回屏重建不丢业务状态。
- bounds 驱动 culling、选择、fit 和 capture。
- 删除/异步 texture 更新无 stale view。
- 两个 renderer 实例互不干扰。

## P3：主包与桌面迁移（1–1.5 周）

### 交付物

- `pixiboardjs` facade。
- NodeHandle、selection、viewport、history、events、capture。
- scoped interactions。
- desktop SDK integration branch。

### 验收

- 两个 board 实例键盘、剪贴板和 resize 不串台。
- destroy 后 listener/ticker/view/texture 回到基线。
- desktop 核心交互 parity。
- desktop 不保留第二套文档写入链。

## P4：Capabilities、Plugin 与 Agent（约 1 周）

### 交付物

- typed BoardCapabilities。
- 新 Plugin API v3 capability contract，不迁移旧插件。
- Agent tools adapter（含 JSON Schema 导出；transport 不在 SDK 范围）。
- origin/revision/transactionId 统一事件。

### 验收

- UI、API、Plugin、Agent、history 产生同语义 ChangeSet。
- Permission denied 不产生部分写入。
- Direct Core、Capabilities 和 Agent tool 三条路径的 document/revision/ChangeSet 等价。
- 旧插件不进入新 SDK host，不存在 v2 host adapter；新 v3 plugin contract 有一个全新示例通过加载验证。

## P5：Browser Adapter 与 Web 示例（1–1.5 周）

### 交付物

- document/asset persistence。
- File/Blob/Text import。
- Object URL 和 download。
- Vanilla Web 示例。

### 验收

- 导入图片、视频、文本并在刷新后恢复。
- Blob URL revoke、asset delete/GC、quota failure 有测试。
- 不支持桌面能力通过 negotiation 表达。
- Web bundle 不静态引入 Tauri modules。

## P6：Public Beta（约 1 周）

### 交付物

- npm package、exports、types、peer dependencies。
- SemVer/Changesets/API report。
- bundle size budget。
- 外部 Vite consumer fixture。
- 文档、API 升级说明和 Document 格式支持边界。

### 验收

- `npm pack` 后可在仓库外干净项目安装运行。
- 无 `workspace:*` 泄漏。
- ESM/types/subpath exports 正确。
- README 最小示例从零可运行。
- package consumer、browser E2E 和 API diff 通过。

## P7：1.0 性能与稳定性（1–2 周）

### 交付物

- deterministic benchmark harness。
- 10k/50k/100k sparse media 数据集。
- Konva 对照数据集。
- memory/texture/listener soak。
- API 兼容、弃用和支持政策。

### 验收

- 性能目标在固定环境连续运行达标。
- 性能回归阈值进入 CI/nightly。
- SDK 新 Document 的 load/save/reload 与不兼容格式拒绝 fixtures 全绿。
- public API 无未说明 breaking change。
- Desktop 和 Web 都消费同一 release candidate。

## 功能 Parity 清单

桌面接入至少覆盖 SDK 新格式项目的：

- 项目加载/切换和 viewport 恢复；旧项目不进入 SDK 路径。
- 图片、视频、音频、模型、文本、Markdown、HTML、SVG 导入。
- 移动、缩放、框选、复制、粘贴、删除、重命名。
- undo/redo。
- preview refresh、generating install、媒体播放。
- capture/export/reveal。
- 新 v3 plugin contract 的 panel/tool 示例；旧插件 zip 不纳入 parity。
- canvas.read/write。

不要求 SDK 承担这些产品 UI，但 SDK 替换不能破坏其能力。

## 发布状态定义

### Internal Alpha

当前 desktop 可通过 SDK 完成主要交互；API 允许变化，不提供外部兼容承诺。

### Public Beta

Web 可完整运行；公开包可安装；API 变更必须记录；不承诺所有 experimental 扩展稳定。

### 1.0

- 核心 API 和 custom node contract 有兼容政策；Document 只支持当前 SDK 格式并明确拒绝不兼容输入。
- Desktop/Web 生产使用。
- 性能和资源生命周期有可重复证据。
- Document rejection、consumer、browser、plugin/Agent 测试完整。
