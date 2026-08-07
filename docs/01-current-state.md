# 当前 Pixi Board 状态评估

## 总体判断

现有项目不是混乱代码库，而是一个边界已经出现、但仍以桌面应用目录组织的成熟应用。SDK 工作的主要任务是提取和校正依赖方向，而不是推倒重写。

## 已存在的正确基础

### 纯领域包

[`packages/board-domain`](../../pixi-board/packages/board-domain/src/index.ts) 已包含：

- `BoardNode`、`Asset`、`BoardSnapshot` 和 viewport 类型。
- 几何、旋转 bounds 和空间计算。
- derivative 选择和节点命名规则。

主要限制是 [`BoardNodeType` 与 `AssetKind` 绑定](../../pixi-board/packages/board-domain/src/types.ts)，当前模型只能表达预定义媒体类型。

### 编辑与历史链路

当前主要写入链已经形成：

```text
BoardEditor
  -> BoardCommand / BoardHistory
  -> BoardMutation / BoardScenePatch
  -> BoardMutationApplier
  -> BoardScene + Persistence + Plugin Events
```

对应代码：

- [`boardStore.ts`](../../pixi-board/apps/desktop/src/board/boardStore.ts)
- [`boardEditor.ts`](../../pixi-board/apps/desktop/src/board/boardEditor.ts)
- [`boardCommands.ts`](../../pixi-board/apps/desktop/src/board/boardCommands.ts)
- [`boardHistory.ts`](../../pixi-board/apps/desktop/src/board/boardHistory.ts)
- [`boardScenePatch.ts`](../../pixi-board/apps/desktop/src/board/boardScenePatch.ts)
- [`boardMutationApplier.ts`](../../pixi-board/apps/desktop/src/board/boardMutationApplier.ts)

这些文件是 `core` 的主要迁移来源。

### 高性能渲染基础

当前 [`BoardScene`](../../pixi-board/apps/desktop/src/board/boardScene.ts) 已具备：

- Pixi Application 生命周期。
- world/overlay 两个内部渲染层。
- RBush 空间索引。
- 视口可见节点同步。
- NodeView 延迟销毁。
- Texture lease 和延迟释放。
- 增量 ScenePatch。
- 选择 overlay、labels 和媒体 runtime。

当前架构文档也已明确“document as data, Pixi scene as cache”：

- [`docs/architecture.md`](../../pixi-board/docs/architecture.md)
- [`docs/performance.md`](../../pixi-board/docs/performance.md)

### 平台适配雏形

[`BoardRepository`](../../pixi-board/apps/desktop/src/storage/boardRepository.ts) 与 browser/Tauri 实现已经提供依赖倒置起点：

- [`browserBoardRepository.ts`](../../pixi-board/apps/desktop/src/storage/browserBoardRepository.ts)
- [`tauriBoardRepository.ts`](../../pixi-board/apps/desktop/src/storage/tauriBoardRepository.ts)
- [`desktopRuntimeAdapter.ts`](../../pixi-board/apps/desktop/src/desktopRuntimeAdapter.ts)

[`pixi.ts`](../../pixi-board/apps/desktop/src/pixi.ts) 也已将 PixiJS import 集中到单点。

### 插件和 Agent 基础

现有插件体系已经包含 permission、capability、tool registry、panel 和 MCP facade：

- [`board-plugin-sdk`](../../pixi-board/packages/board-plugin-sdk/src/types.ts)
- [`board-tool-runtime`](../../pixi-board/packages/board-tool-runtime/src/runtimeTypes.ts)
- [`pluginRuntimeHost.ts`](../../pixi-board/apps/desktop/src/plugins/pluginRuntimeHost.ts)
- [`tauriMcpToolHost.ts`](../../pixi-board/apps/desktop/src/tauriMcpToolHost.ts)
- [`board-plugin-canvas`](../../pixi-board/packages/board-plugin-canvas)

因此目标不是重新发明插件系统，而是让它依赖统一 `BoardCapabilities`，不再依赖桌面 `MediaWhiteboard`。

## 主要架构债务

### 画布核心埋在 desktop app

`apps/desktop/src/board/` 同时包含：

- Core 数据与命令。
- Pixi renderer。
- 输入与工具。
- 媒体运行时。
- 选择面板、右键菜单、名称编辑等产品 UI。
- 文件、预览和持久化协调。

文件职责大多明确，但物理位置无法表达未来 SDK 边界。

### `MediaWhiteboard` 是过重组合根

[`whiteboard.ts`](../../pixi-board/apps/desktop/src/whiteboard.ts) 同时创建 Store、Editor、Scene、Viewport、Assets、Import、Persistence、Selection UI、Interaction、Writes 和 plugin events。它适合当前应用启动，不适合作为公共 SDK 类。

### Repository 接口过宽

当前接口把文档持久化、资产导入、URL、derivative、下载和 Finder reveal 放在一起。结果是 browser repository 对许多方法直接抛出 unavailable。

目标需要拆分：

```text
DocumentPersistence
AssetStore
AssetResolver
AssetImporter
ExportCapability
DesktopShellCapability
```

### Browser mode 不是完整 Web SDK

Browser repository 当前主要提供内存 snapshot 和资产 metadata 更新，不支持完整媒体导入、URL、derivative、文本资产和持久恢复。因此“能在 browser 启动画布”不能等同“可交付网页 SDK”。

### 多实例输入不安全

[`boardInteractionController.ts`](../../pixi-board/apps/desktop/src/board/boardInteractionController.ts) 监听全局 `window` 的 keyboard、clipboard、pointer 和 resize。SDK 必须引入 focused instance、InputScope 和可配置 interaction policy。

### 自定义节点缺少注册协议

[`nodeView.ts`](../../pixi-board/apps/desktop/src/board/nodeView.ts) 直接按内置节点类型创建 Sprite 或 generating visual。新增节点需要修改领域 union 和渲染分支，无法由用户注册。

### Store 对外不可直接复用

当前 `getNode()`、`getNodes()`、`getAsset()` 返回内部对象或数组引用。公共 SDK 必须提供 immutable snapshot 或 ID-based `NodeHandle`，所有写入经过 transaction。

### 命令与事件还不是长期公共契约

- `BoardCommand` 使用 apply/revert 闭包，不适合持久 command log 或跨端 replay。
- selection、viewport、assets 和 board mutation 事件分散。
- `BoardChangeOrigin` 定义在 plugin SDK，而不是 core。
- 插件 capability 中大量使用 `unknown`。
- JS `BoardSnapshot` 不携带 canonical schemaVersion；版本更多存在于 Rust 持久文件层。

## 当前代码成熟度判断

| 领域 | 当前成熟度 | SDK 处理方式 |
|---|---:|---|
| Domain/geometry | 高 | 迁移并扩展 schema/version |
| Editor/history | 中高 | 提取，改为受控 transaction API |
| Scene/virtualization | 高 | 提取为 renderer-pixi |
| Texture/media runtime | 中高 | 保留并改为 renderer/asset context |
| Browser persistence/assets | 低 | 新建完整 adapter |
| Public API | 低 | 新建 facade 和 NodeHandle |
| Custom nodes | 低 | 新建 NodeTypeRegistry |
| Plugin capabilities | 中 | 类型化并绑定 BoardCapabilities |
| Agent tools/MCP | 中高 | 保留语义，拆开 tool 与 transport |
| Release/benchmark | 低 | 增加 npm、browser matrix 和 benchmark |

## 迁移结论

SDK 提取是中等规模架构重组，不是基础技术验证。最安全的切入点是先实现 Node Type Registry 垂直切片，再按 core、renderer、facade、capabilities、platform adapters 顺序迁移。

