# 从 Pixi Board 迁移到 PixiBoardJS

## 策略

采用绞杀式迁移：新 SDK 每形成一个稳定能力，现有 desktop app 立即改为消费它；旧路径在 parity 验收后删除。禁止先复制全部代码到新仓库、长期维护两套 Store/Scene/WriteService。

## 当前代码到目标层的映射

### Core

| 当前路径 | 目标 | 迁移方式 | 关键改造 |
|---|---|---|---|
| `packages/board-domain/src/types.ts` | `core/document` | 重构迁移 | type 与 asset kind 解耦，增加 schema/type version、props |
| `geometry.ts` | `core/geometry` | 直接迁移 | 默认旋转矩形 bounds，允许 node definition 覆盖 |
| `boardStore.ts` | `core/store` | 重构迁移 | Map/index、immutable output、revision、maxZIndex |
| `boardCommands.ts` | `core/commands` | 重构迁移 | patch/transaction 语义，移除 Scene 命名 |
| `boardHistory.ts` | `core/history` | 重构迁移 | 使用 forward/inverse patches，`scenePatch` 改 ChangeSet |
| `boardEditor.ts` | `core/editor` | 拆分迁移 | 正式 editor、transient editor、clipboard model |
| `boardScenePatch.ts` | `core/change-set` | 重命名升级 | revision、transactionId、origin、viewport/assets |
| `boardViewport.ts` | `core/viewport` | 直接迁移 | 移除 desktop utils 依赖，配置 scale policy |
| `boardChangeGuards.ts` | `core/change-guards` | 直接迁移 | 保留确定性比较 |

源目录：[`apps/desktop/src/board`](../../pixi-board/apps/desktop/src/board)。

### Renderer Pixi

| 当前路径/模块 | 目标 | 迁移方式 | 关键改造 |
|---|---|---|---|
| `pixi.ts` | `renderer-pixi/pixi` | 直接迁移 | 包内单一 Pixi boundary |
| `boardScene.ts` | `renderer-pixi/scene` | 重构迁移 | 配置化 init，只依赖 DocumentReader/ChangeSet |
| `boardSpatialIndex.ts` | `renderer-pixi/spatial` | 直接迁移 | bounds 从 NodeTypeRegistry 获取 |
| `boardSceneViewportSync.ts` | `renderer-pixi/culling` | 直接迁移 | 保持 visible+padding 模型 |
| `nodeViewRegistry.ts` | `renderer-pixi/views` | 重构迁移 | 通过 renderer registry 创建/更新/销毁 |
| `nodeView.ts` | 内置媒体 renderer | 重写吸收 | 删除 generating/asset 硬编码总分支 |
| `textureCache.ts` 等 | `renderer-pixi/textures` | 直接迁移 | 对自定义节点提供 lease context |
| `selectionOverlayLayer.ts` | `renderer-pixi/overlays` | 直接迁移 | 输入只读 selection/bounds |
| `nodeLabel*` | `renderer-pixi/labels` | 直接迁移 | 不依赖产品 name editor |
| `mediaRuntimeRegistry.ts` 等 | `renderer-pixi/media` | 拆分迁移 | 视频/音频运行态可销毁、按需 ticker |
| `boardFrameScheduler.ts` | `renderer-pixi/scheduler` | 重构迁移 | 支持 request-render 和 idle 停帧 |

### Interactions

| 当前模块 | 目标 | 关键改造 |
|---|---|---|
| `boardInteractionController.ts` | `pixiboardjs/interactions` | active/focused instance；拆 clipboard/keyboard/pointer |
| `boardHotkeyController.ts` | `interactions/keyboard` | host-configurable bindings |
| `boardViewportWheel.ts` | `interactions/viewport` | 依赖 viewport API，不依赖 Scene 私有对象 |
| `tools/*` | `interactions/tools` | ToolContext 改受控 ports，事件不暴露 Pixi type |
| `clipboard.ts` | `core/clipboard-model` 或 host clipboard | 消除进程级 singleton 和多实例串台 |

### Capabilities 与 Assets

| 当前模块 | 目标 | 迁移方式 |
|---|---|---|
| `boardWriteService.ts` | `capabilities/nodes-assets` | 拆 UI/Scene/Persistence 依赖后重构 |
| `boardNodeCreationService.ts` | `capabilities/node-create` | 保留 placement/asset 语义 |
| `boardNodeDeletionService.ts` | `capabilities/node-delete` | asset GC 改显式 policy |
| `boardPreviewService.ts` | `capabilities/preview` | renderer capture 与 asset pipeline 分开 |
| `boardGeneratingNodeService.ts` | `capabilities/generating` | 统一 transaction/origin |
| `assetImport*`、`importWorkflow.ts` | `capabilities/import` | 移除 UI overlay/status callback |
| `apps/desktop/src/assets/*` | `assets-core` + `assets-browser` | 按 DOM/平台依赖拆分 |
| `boardMutationApplier.ts` | 被统一 commit pipeline 替代 | 不整文件迁移 |
| `boardLoadService.ts` | runtime load orchestration | 不整文件迁移 |
| `boardPersistenceController.ts` | persistence subscriber | 订阅 core change event |

### 平台与产品层

| 当前模块 | 目标归属 |
|---|---|
| `browserBoardRepository.ts` | 新 browser adapters 的行为参考，原接口废弃 |
| `tauriBoardRepository.ts` | `adapter-tauri` 的多个窄接口实现 |
| `desktopRuntimeAdapter.ts` | desktop host composition |
| `whiteboard.ts` | 拆为 `createPixiBoard` runtime + desktop UI wiring |
| selection panel/context menu/name editor | 留 desktop product |
| project switcher/toolbar/status/main shell | 留 desktop product |
| Tauri dialog/Finder/project/plugin/process | 留 adapter/desktop host |

### 插件和 Agent

| 当前模块 | 目标 |
|---|---|
| `packages/board-plugin-sdk` | 作为新 Plugin API v3 的公共契约；现有插件不迁移 |
| `packages/board-tool-runtime` | plugin host/runtime 基础 |
| `plugins/pluginRuntimeHost.ts` | 改为 BoardCapabilities consumer |
| `packages/board-plugin-canvas` | thin Agent tools / official canvas plugin |
| `tauriMcpToolHost.ts` | MCP transport host |

## 分阶段迁移

### M0：冻结 SDK Document 边界

工作：

- 固化 SDK 自身新 `BoardDocument` 的有效与无效 fixtures。
- 列出 desktop 功能 parity 清单。
- 固化现有 unit tests；记录旧插件清单为 deprecated，不将旧插件 fixture 作为 SDK 验收输入。
- 确认扁平模型、不做场景树。
- 确认 public API draft 和 ADR。
- 确认旧 snapshot、schema-v4、旧项目目录和旧 node data shape 明确拒绝；旧应用继续自行管理旧数据。
- 确认 SDK 不实现 legacy document adapter、数据 migration 或 backup-before-migration。

退出条件：新 Document 契约、拒绝边界和现有关键行为有可重复基线；Node/Asset/ChangeSet 语义允许进入实现。

### M1：Headless Core

工作：

- 创建 core 包。
- 迁移 domain/store/editor/history/viewport。
- 引入 schemaVersion、revision、transaction 和 ChangeSet。
- Node type 与 Asset kind 解耦。
- 新 Document 的确定性 serialization/validation；拒绝非当前 schemaVersion、typeVersion 和 legacy shape。

并行接入：desktop 暂时通过宿主 adapter 使用新 core，renderer 仍在原位置。该 adapter 只做 runtime 接线，不读取或转换旧数据。

退出条件：core 依赖图无 DOM/Pixi/Tauri/plugin；新 Document load/save/reload 与不兼容格式拒绝测试通过；CRUD/transaction/undo 测试通过。

### M2：NodeTypeRegistry 与 Renderer

工作：

- 建立数据和 Pixi renderer registry。
- 迁移 Scene、spatial、views、textures、overlay。
- 所有内置节点通过 registry。
- unknown node placeholder。
- 离屏销毁/回屏重建测试。

退出条件：自定义 task-card 完整运行；renderer 不修改 Store；无持久状态只存在 View。

### M3：Facade 与 Interactions

工作：

- `createPixiBoard()`、NodeHandle、nodes/selection/viewport/history/events/capture。
- 多实例 focus scope。
- 统一 SDK pointer event。
- destroy 清理所有 listener/ticker/lease。

退出条件：Vanilla 页面两个实例互不干扰；外部 consumer 只通过主包 API 完成基本编辑。

### M4：Capabilities 与 Assets

工作：

- 拆 Repository ports。
- 重构 BoardWriteService 语义。
- 迁移 preview/import pipeline。
- persistence subscriber。
- typed capabilities、origin 和错误。

退出条件：UI/Plugin/Agent 可调用同一 capability contract；一次批量写产生一个 transaction/change/save schedule。

### M5：Desktop 切换

工作：

- 用 SDK runtime 替换 MediaWhiteboard 内部实现。
- desktop UI 改用 SDK/capabilities。
- 注入 Tauri adapters。
- PluginRuntimeHost 改用 capabilities。
- 保持 Agent/MCP 能力语义；现有插件 zip 不作为 SDK parity 目标。

退出条件：desktop 不再实例化第二套 BoardStore/BoardScene/BoardEditor；新 SDK Document 项目的功能 parity 完成。旧项目仍由旧应用路径打开和保存，不进入 SDK 验收。

### M6：Browser 完整能力

工作：

- IndexedDB document/metadata + OPFS media/derivatives，并实现 Blob fallback。
- File/Blob/Text/URL import。
- Object URL、derivative、download 和 asset GC。
- 独立 web examples。

退出条件：浏览器导入、保存、刷新恢复、导出和删除完整闭环。

### M7：Plugin、Agent 与发布收口

工作：

- canvas read/write 下沉重复能力。
- 新 Plugin API v3 typed contract，不实现旧插件迁移或 v2 adapter。
- MCP/direct Agent contract tests。
- npm packaging、API report、consumer fixtures。
- benchmark 和性能门禁。

退出条件：满足 beta/1.0 release gates。

## 每阶段回滚策略

- 新 core/renderer 在 desktop 中通过 feature flag 或薄宿主 adapter 接入，parity 前保留旧应用调用入口；该 adapter 不承担旧数据转换。
- 同一个项目会话不得同时维护两套文档真相；切换以实例级 feature flag 完成。
- SDK 只写自身新 Document 格式；旧格式在写入前拒绝，因此没有 migration 写回或迁移前备份流程。
- 现有官方/内部插件直接废弃；未来新插件按 v3 重新开发，不维护 v2 adapter。
- Browser adapter 与 Tauri adapter 使用同一 contract suite，任何一端失败不通过共同接口验收。

## 明确不顺手处理的事项

- 不在 SDK 迁移中重做所有产品 UI。
- 不引入场景树或多人协作。
- 不同时更换 PixiJS 主版本。
- 不为了目录整洁重写已经稳定的 preview 算法。
- 不在 core 提取阶段同时重新设计 Agent tool schema。

## 源项目执行约束

- 迁移期间修改现有前端项目后不主动执行 desktop build 或 TypeScript typecheck，保持当前快速开发约定；使用目标阶段定义的定向测试和用户反馈推进。
- 旧插件不纳入 SDK 迁移，SDK 阶段不为旧插件重新打包或复制 zip；未来新插件开发时再按新宿主流程验证。
- 如果迁移阶段修改现有 `packages/board-domain`，阶段结束前必须重新构建 `board-domain`。
- 新 SDK 包自身在建立独立 CI 后按本计划执行 core/renderer/package contract 测试；该约束不等于永远不验证 SDK。
