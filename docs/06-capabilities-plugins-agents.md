# Capabilities、插件与 Agent

## 分层结论

```text
Product UI ───────────────┐
Plugin Capability Proxy ─┼──> BoardCapabilities ──> PixiBoardJS Runtime
Agent Tool Adapter ──────┘
```

插件和 Agent 不直接访问 Store、Editor、Scene、TextureCache 或 platform repository。统一能力层负责权限、校验、origin、transaction、错误翻译和审计。

## BoardCapabilities

```ts
export type BoardCapabilities = {
  document: DocumentCapability;
  nodes: NodeCapability;
  assets: AssetCapability;
  selection: SelectionCapability;
  viewport: ViewportCapability;
  history: HistoryCapability;
  preview: PreviewCapability;
  capture?: CaptureCapability;
};
```

### 节点能力

```ts
type NodeCapability = {
  read(input: ReadNodesInput): Promise<ReadNodesResult>;
  create(input: CreateNodesInput, options?: WriteOptions): Promise<WriteResult>;
  update(input: UpdateNodesInput, options?: WriteOptions): Promise<WriteResult>;
  delete(input: DeleteNodesInput, options?: WriteOptions): Promise<WriteResult>;
};
```

写入 options：

```ts
type WriteOptions = {
  origin: "user" | "api" | "history" | `plugin:${string}` | `agent:${string}`;
  label?: string;
  signal?: AbortSignal;
  requestId?: string;
};
```

## 与低层 API 的区别

- `board.nodes.update(id, patch)` 面向同进程应用开发者，粒度低、类型强。
- `BoardCapabilities.nodes.update(input)` 面向宿主边界，支持批量、权限、origin、错误和可序列化结果。
- 两者最终调用同一 transaction service，不维护两套业务实现。

## 插件层

### Plugin SDK

公共契约负责：

- manifest/apiVersion。
- permissions。
- typed PluginContext。
- tools、panels、actions、file drop 和 selection contributions。
- capability interface。

源项目 `pixi-board`（私有仓库）中现有的 `board-plugin-sdk`（`packages/board-plugin-sdk/src/types.ts`）是迁移输入；Plugin API v3 直接使用 SDK 类型替换核心 `unknown` DTO。

### Plugin Host

负责：

- 加载与卸载插件。
- permission gate。
- 为每个插件绑定 scoped capability proxy。
- jobs、HostFile、storage、HTTP 和 process。
- contribution/tool registry。

Plugin Host 位于产品层或可选宿主包，不进入 `core` 和 `renderer-pixi`。

### Plugin Loader

```text
Desktop: zip -> verify -> ESM module in WebView
Web: trusted ESM URL / dynamic import
```

Loader 只解决代码来源，Plugin Host 解决生命周期和 capability。现有 zip、resources 和 executables 机制不作为 SDK 迁移目标；未来新插件按 Plugin API v3 开发，不提供 v2 adapter。

### 三类插件

1. **Node plugin**：注册 NodeTypeDefinition 和 Pixi renderer。
2. **Feature plugin**：使用 capabilities，提供 panel/action/tool。
3. **Agent tool plugin**：注册高层 Agent 工具，内部使用 capabilities。

自定义 Pixi renderer 属于可信代码扩展，不是安全沙箱。权限系统能限制 host capability，不能阻止同一 WebView 中的恶意 JavaScript。

## Agent 层

### Agent Tools

`canvas.read` 和 `canvas.write` 属于 Agent adapter，不属于 core：

```text
canvas.read/write schemas
        │
        ▼
filter / pagination / compact DTO / default layout
        │
        ▼
BoardCapabilities
```

保留在 Agent adapter 的职责：

- JSON Schema。
- Agent 友好字段名。
- 分页、字段投影和 compact response。
- source content/path 输入翻译。
- 默认布局意图解析。
- 错误序列化和多模态 preview 输出。

下沉到 capabilities 的职责：

- 节点与资产关联查询。
- create/update/delete transaction。
- preview/capture。
- asset import 和清理。
- origin、revision 和 ChangeSet。

### Transport 不属于 SDK

SDK 到 `agent-tools` 为止；MCP、HTTP、WebSocket 只是把同一份工具契约搬运出去的方式，由接入方按自己的 harness 组装：

```text
Claude/Codex/Other Agent
        │ transport（接入方自行组装）
        ▼
Agent Tools（canvas.read / canvas.write + JSON Schema）
        ▼
BoardCapabilities
```

进程内直接调用：

```ts
const tools = createPixiBoardAgentTools(board.capabilities);
await tools.call("canvas.write", input);
```

JSON Schema 单独从 `@pixi-board/agent-tools/schemas` 导出，供接入方注册到自己的 tool registry。

不把 transport 放进 SDK 的原因：协议仍在演进（MCP 本身的握手与能力协商还在变），而画布语义不该跟着协议版本走。工具契约稳定、传输可替换，是这条边界的目的。

## Headless Agent

无 renderer 时可支持：

- document read/write。
- node CRUD。
- history/transaction。
- current-format schema validation；不兼容 Document 明确拒绝。
- 纯数据布局。

需要 mounted renderer 或 preview backend：

- viewport capture。
- Pixi custom node screenshot。
- 视频帧捕获。
- 依赖浏览器 DOM 的 HTML/Markdown 栅格预览。

工具必须在 schema 或 result 中表达 capability availability。

## 一致性要求

对于同一个 update：

```text
UI、Plugin、Agent、API
```

必须产生一致的：

- document result。
- revision。
- ChangeSet。
- history entry。
- renderer update。
- persistence schedule。

区别只在 `origin`、权限和返回 DTO。

## 新插件 API

1. 将 `BoardChangeOrigin` 和核心 ChangeSet 移入 core/capabilities。
2. 发布 Plugin API v3，使用 typed Node/Asset DTO 和 BoardCapabilities。
3. 现有官方与内部插件不迁移，随旧应用插件体系废弃；SDK 只为未来新插件提供 v3 contract。
4. `PluginRuntimeHost` 从依赖 `MediaWhiteboard` 改为依赖 `BoardCapabilities` 和事件 ports。
5. `board-plugin-canvas` 改为 thin Agent adapter。

## 验收

- 同一 contract test suite 分别调用 direct capabilities、新 v3 plugin proxy 和 Agent tool。
- 权限拒绝不会发生部分写入。
- 取消耗时操作后不存在迟到 mutation。
- Plugin Host 销毁后清理所有 panel、listener、job 和 tool registration。
