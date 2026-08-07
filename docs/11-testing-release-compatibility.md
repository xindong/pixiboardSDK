# 测试、发布与兼容策略

## 当前基线缺口

现有工程已有较多 TypeScript/Rust 单元测试，但缺少：

- 真实 browser/WebGL E2E。
- 多实例和 destroy 泄漏测试。
- SDK 仓库外消费测试。
- npm 发布流程。
- 性能 benchmark 和回归阈值。
- Tauri 安装/启动 smoke。
- CI 中完整 Rust test job。

现有 CI 和 release 可参考：

- [`ci.yml`](../../pixi-board/.github/workflows/ci.yml)
- [`release.yml`](../../pixi-board/.github/workflows/release.yml)

## 测试金字塔

### Core Unit

- document CRUD 和索引。
- transaction atomicity。
- undo/redo 和 transient commit。
- selection/viewport。
- schema validation/migration。
- NodeTypeRegistry、unknown node。
- ChangeSet 确定性。
- 旧 snapshot fixtures。

不使用 DOM 测试环境。

### Renderer Unit/Integration

- renderer registry 生命周期。
- bounds、spatial index、visible set。
- View create/update/destroy。
- 异步纹理竞态和 AbortSignal。
- Texture lease。
- selection overlay/capture。
- request-render/continuous-render 切换。

允许使用 Pixi test adapter；关键路径必须有真实 browser/WebGL 测试补充。

### Adapter Contract Tests

同一 suite 运行在 memory、browser 和 Tauri adapter：

- document load/save/round-trip。
- asset put/get/delete/resolve。
- derivative 保存。
- cancellation/error recovery。
- capability negotiation。

桌面专属能力单独测试。

### Browser E2E

Playwright 至少覆盖 Chromium；beta 后增加 WebKit：

- 创建、编辑、保存、刷新恢复。
- File/Blob import。
- 自定义节点。
- 多实例 focus/clipboard。
- capture/download。
- destroy/recreate。
- WebGL context loss 或 renderer failure 基础恢复。

### Desktop Integration

- 旧项目打开和迁移。
- import/preview/playback/export。
- project switch。
- plugin zip、panel、tool、process。
- MCP HTTP 和 stdio round-trip。
- macOS/Windows 启动 smoke。

### Plugin/Agent Contract

- Direct BoardCapabilities。
- Plugin capability proxy。
- Agent tool direct call。
- MCP call。

同一输入断言 document/change/history/persistence 语义一致。

## CI 分层

### Pull Request

- formatting/lint（实现后引入）。
- core/renderer unit。
- package dependency boundary check。
- migration fixtures。
- package contract 和 TypeScript API check。
- Chromium basic smoke。

### Nightly

- 完整 browser E2E。
- 100k benchmark。
- memory/destroy soak。
- `cargo test`。
- plugin/Agent/MCP integration。

### Release Candidate

- `npm pack` external consumer。
- macOS/Windows Tauri smoke。
- old project fixtures。
- 新 Plugin API v3 fixture；旧插件被拒绝或标记 deprecated 的行为。
- public API diff。
- bundle size 和 performance gates。

Release workflow 必须依赖已经通过验证的 commit/artifact，不能只在 tag 后直接打包。

## NPM 发布

首批公开包：

```text
pixiboardjs
@pixi-board/plugin-sdk
@pixi-board/core
```

要求：

- 无 `workspace:*` 泄漏。
- exports/types 正确。
- tree-shaking/sideEffects 明确。
- PixiJS 单实例策略明确。
- CSS、worker、wasm/assets 有可消费路径。
- `npm pack` 内容经过检查。
- 仓库外 Vite fixture 安装并运行。

## 版本维度

需要分开管理：

- SDK semver。
- document schemaVersion。
- node typeVersion。
- plugin apiVersion。
- Agent tool schema version。

这些版本表达不同兼容关系，不能合并成一个数字。

## Breaking Change 规则

### Stable API

- 删除/重命名公共方法属于 major。
- 改变事件顺序、transaction atomicity 或错误类别属于 breaking。
- document migration 必须支持所有仍在支持窗口内的 schema。

### Experimental API

自定义 selection handle、advanced hit test、WebGPU 等可以通过 `experimental` 命名空间提供，在 minor 版本中调整，但必须记录；不提供全局 renderer escape hatch。

## Plugin 兼容

- SDK host 直接采用 Plugin API v3，不提供 v2 adapter。
- 当前官方和内部 v2 插件不迁移，直接废弃；新插件从 v3 开始开发。
- SDK 版本和 plugin API 版本不强制一一对应。
- 自定义 renderer 插件必须声明 `renderer:trusted`。
- 插件包体积设置预算，大型 sidecar/模型不应全部内嵌主 bundle。

## Document 兼容

- 永不静默丢弃未知 node type 或未来字段。
- 加载未来 schema 默认拒绝并给出明确错误，除非定义 forward-compatible policy。
- migration fixture 必须覆盖真实旧项目，不只覆盖人工最小 JSON。
- 保存新格式前可生成备份，具体由 Tauri/browser persistence policy 实现。

## Alpha/Beta/Stable 支持策略

- Alpha：内部使用，允许频繁 API 调整。
- Beta：公开使用，breaking change 需 changelog 和 migration note。
- Stable：semver、弃用周期、document 支持窗口和 API report 强制执行。
