# PixiBoardJS 开发者文档

这份文档面向**使用 SDK 构建应用的人**。它介绍公开包、可调用的 API 和接入方式；架构决策与迁移记录请看 [`docs/README.md`](../README.md)。API 以当前发布包的导出和测试为准，规划文档中的未来能力不会自动成为公共 API。

## 安装

日常应用只需要安装主包：

```sh
pnpm add pixiboardjs
```

如果需要 Agent 工具契约，再安装：

```sh
pnpm add @pixi-board/agent-tools
```

`@pixi-board/capabilities` 适合需要直接接入统一读写能力层的宿主；普通画布应用优先使用 `board.capabilities`，不必自行创建能力实例。

## 第一个画布

Core 不会替应用猜测节点 `props` 的结构。创建节点前先注册应用需要的数据类型；renderer 是否有同名绘制器与数据类型注册是两件事。

```ts
import { createPixiBoard, type CustomNodeDefinition } from "pixiboardjs";

const rect: CustomNodeDefinition<{ fill: number }> = {
  type: "app.rect",
  version: 1,
  defaults: { fill: 0x7c8cf8 },
  validate(value) {
    const input = (value ?? {}) as Partial<{ fill: number }>;
    return { fill: typeof input.fill === "number" ? input.fill : 0x7c8cf8 };
  },
  getBounds(node) {
    return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
  },
};

const board = await createPixiBoard({
  container: document.querySelector("#board"),
});
await board.nodeTypes.register(rect);
await board.ready;

const node = await board.nodes.create({
  type: "app.rect",
  x: 40,
  y: 40,
  width: 120,
  height: 80,
  props: { fill: 0x7c8cf8 },
});

board.viewport.fitBounds({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
board.history.undo();
await board.destroy();
```

> `createPixiBoard()` 返回 Promise；`board.ready` 表示挂载和初始运行时准备完成。headless 使用时省略 `container`，但 capture 等依赖 renderer 的能力不可用。

## 节点操作

- `board.nodes.create(input)` 创建节点并返回 `NodeHandle`。
- `board.nodes.get(id)` 读取当前不可变快照。
- `board.nodes.list(filter)` 按 id、type、可见性等条件查询。
- `board.nodes.update(id, patch)` 更新几何或 `props`。
- `board.nodes.remove(id)` 删除节点。
- `board.nodes.resize(id, request)` 使用节点注册时的 `ResizePolicy`。

`board.node(id)` 提供 ID-based handle，可调用 `x()`、`y()`、`width()`、`height()`、`visible()`、`setAttrs()`、`getAttrs()` 和 `on("change", listener)`。

## 事务、选择和视口

```ts
board.transaction("Arrange cards", () => {
  board.nodes.update("a", { x: 0, y: 0 });
  board.nodes.update("b", { x: 240, y: 0 });
}, { origin: "api", coalesceKey: "arrange-cards" });

board.selection.set(["a", "b"]);
board.selection.toggle("c");
board.selection.clear();

board.viewport.panBy(120, 0);
board.viewport.zoomAt({ x: 400, y: 300 }, 1.2);
board.viewport.fitNodes(["a", "b"]);
board.viewport.toWorld({ x: 400, y: 300 });
```

事务 callback 必须同步执行；一次事务产生一个 revision、ChangeSet 和 history entry。连续手势可复用 `coalesceKey`，让撤销时合并为一个步骤。

## 事件和文档

```ts
const off = board.on("change", ({ revision, changeSet }) => {
  console.log(revision, changeSet);
});
board.on("selection:change", listener);
board.on("viewport:change", listener);
board.on("history:change", listener);
board.on("render:complete", listener);

const snapshot = board.document.snapshot();
const json = board.document.toJSON();
board.document.validate(json);
await board.document.load(json, { replaceHistory: true });
off();
```

当前 SDK 只接受自身定义的 `BoardDocument` 格式；旧项目和旧 schema 不会被隐式迁移。

## 浏览器接入

浏览器专用导出位于 `pixiboardjs/browser`。可选地使用 `attachDomTransformer(board, { overlay })` 将八个缩放控制点投影到 DOM；控制点样式由宿主提供。持久化接口通过 `persistence: { load, save, destroy? }` 注入，具体 IndexedDB/OPFS adapter 以发布包导出为准。

## 自定义节点

使用 `board.nodeTypes.register()` 注册数据校验、默认值、bounds 和可选 `resize` 策略。需要绘制时，在同一个定义上提供 renderer 的 `create`、`update`、`destroy`。持久化业务状态写入 `node.props`，不要只放在渲染对象中；renderer 的临时对象在离屏后可能被销毁并重建。

```ts
await board.nodeTypes.register({
  type: "acme.task-card",
  version: 1,
  defaults: { title: "New task" },
  validate: (value) => ({ title: typeof (value as { title?: unknown })?.title === "string"
    ? (value as { title: string }).title : "New task" }),
  getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }),
});
```

## Site 实现范式：选择、编辑、历史与媒体节点

下面的范式来自 `apps/site` 的真实实现，但只依赖公开的 `PixiBoard` API。它适用于白板、流程图和素材编排器等宿主：节点数据保持扁平可序列化，交互统一走 selection、transaction 和 history，渲染器只管理临时显示对象。

### 通用节点定义

先定义数据契约，再注册 renderer。`validate()` 负责恢复可靠的 props，`getBounds()` 负责命中和框选，`resize` 负责约束尺寸。

```ts
type TextProps = { text: string; style?: Record<string, JsonValue> };
type MediaKind = "image" | "video" | "audio";
type MediaProps = { name: string; mimeType: string; size: number };

const textDefinition: CustomNodeDefinition<TextProps> = {
  type: "text", version: 1, defaults: { text: "" },
  resize: {
    mode: "custom",
    resize: ({ node, width }) => ({ width, height: measureTextHeight(node.props, width) }),
  },
  validate(value) {
    const input = (value ?? {}) as Partial<TextProps>;
    return { text: typeof input.text === "string" ? input.text : "", style: input.style };
  },
  getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }),
};

function mediaDefinition(type: MediaKind): CustomNodeDefinition<MediaProps> {
  return {
    type, version: 1,
    defaults: { name: "", mimeType: "", size: 0 },
    resize: type === "audio"
      ? { mode: "custom", resize: ({ node, width }) => ({ width, height: node.height }) }
      : { mode: "aspect-ratio" },
    validate(value) {
      const input = (value ?? {}) as Partial<MediaProps>;
      return {
        name: typeof input.name === "string" ? input.name : "",
        mimeType: typeof input.mimeType === "string" ? input.mimeType : "",
        size: typeof input.size === "number" ? input.size : 0,
      };
    },
    getBounds: (node) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height }),
  };
}

await board.nodeTypes.register(textDefinition);
for (const type of ["image", "video", "audio"] as const) {
  await board.nodeTypes.register(mediaDefinition(type));
}
```

文字节点按字体和换行宽度计算高度，不能把文字当图片直接设置 `width` / `height` 拉伸。图片和视频使用 `aspect-ratio`；音频波形通常固定高度，只允许横向拉伸。

### 多选、框选和多节点移动

选择状态与文档节点分离：普通点击替换选择，`Shift` / `Cmd` / `Ctrl` 点击切换单个节点；空白区域拖拽时把屏幕矩形转换为世界矩形，再设置命中的节点。

```ts
function selectByPointer(event: PointerEvent, nodeId?: string) {
  const additive = event.shiftKey || event.metaKey || event.ctrlKey;
  if (!nodeId) return board.selection.clear();
  if (additive) board.selection.toggle(nodeId);
  else board.selection.set([nodeId]);
}

function selectInScreenRect(start: Point, end: Point) {
  const a = board.viewport.toWorld(start);
  const b = board.viewport.toWorld(end);
  const rect = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  const ids = board.nodes.list().filter((node) => node.x < rect.maxX && node.x + node.width > rect.minX && node.y < rect.maxY && node.y + node.height > rect.minY).map((node) => node.id);
  board.selection.set(ids);
}

function moveSelection(dx: number, dy: number) {
  const origins = board.selection.get().map((id) => board.nodes.get(id)).filter(Boolean)
    .map((node) => ({ id: node!.id, x: node!.x, y: node!.y }));
  board.transaction("Move selection", () => {
    for (const origin of origins) board.nodes.update(origin.id, { x: origin.x + dx, y: origin.y + dy });
  }, { origin: "ui", coalesceKey: "drag-selection" });
}
```

拖拽的每一帧都可以复用同一个 `coalesceKey`，整次手势就只占一个 undo step。

### 文字编辑：DOM overlay + 节点事务

Pixi 文本负责显示，原位编辑使用 DOM `textarea` 覆盖在节点上。编辑框必须复用渲染态的字体、字号、字重、行高、颜色和宽度；编辑时使用不透明背景覆盖原文字，避免虚影。`Esc` 取消，失焦或 `Cmd/Ctrl + Enter` 提交。

```ts
function commitText(nodeId: string, editor: HTMLTextAreaElement) {
  const current = board.nodes.get<TextProps>(nodeId);
  if (!current) return;
  const text = editor.value.replace(/\r\n/g, "\n");
  const height = measureTextHeight({ ...current.props, text }, current.width);
  board.transaction("Edit text", () => {
    board.nodes.update(nodeId, { height, props: { ...current.props, text } });
  }, { origin: "ui" });
}
```

视口平移或缩放时重新计算 overlay 的屏幕位置和尺寸；overlay 只是交互层，唯一事实来源仍是 `node.props.text`。

### Undo / redo 与事务边界

离散动作各自建立有语义的事务，连续拖拽或缩放使用稳定的 `coalesceKey`。撤销和重做直接使用历史栈，不要在业务层自行反向计算 patch。

```ts
await board.nodes.create({
  type: "image", x: 80, y: 80, width: 320, height: 180,
  props: { name: "cover.jpg", mimeType: "image/jpeg", size: 240_000 },
  assetRefs: { preview: { assetId: "asset-123", variant: "preview" } },
});

if (board.history.canUndo()) board.history.undo();
if (board.history.canRedo()) board.history.redo();
```

一个事务产生一个 revision、ChangeSet 和 history entry；文字提交、创建节点、删除节点等是离散事务，拖拽手势则合并提交。

### 图片、视频、音频：assetRefs + renderer

媒体节点的 `props` 只存描述信息，实际文件或纹理通过 `assetRefs` 引用。内置 Pixi renderer 会按候选 ref 名称查找资源：image 使用 `preview/image/primary/source`，video 使用 `preview/poster/video/primary/source`，audio 使用 `waveform/preview/audio/primary/source`。

```ts
const mediaRenderer = (kind: MediaKind): CustomNodeRenderer<MediaProps> => ({
  async create(node, ctx) {
    const names = kind === "image"
      ? ["preview", "image", "primary", "source"]
      : kind === "video"
        ? ["preview", "poster", "video", "primary", "source"]
        : ["waveform", "preview", "audio", "primary", "source"];
    const ref = names.map((name) => node.assetRefs?.[name]).find(Boolean);
    const lease = ref ? await ctx.assets.acquireTexture(ref, { kind }) : undefined;
    const display = await ctx.display.createImage?.(ref, node) ?? ctx.display.createContainer();
    if (lease?.texture !== undefined) display.texture = lease.texture;
    return { displayObject: display, state: { lease } };
  },
  update(view, node) {
    Object.assign(view.displayObject, { x: node.x, y: node.y, rotation: node.rotation, width: node.width, height: node.height });
  },
  destroy(view) {
    view.displayObject.destroy?.({ children: true });
    view.state.lease?.release?.();
  },
});
```

资源 lease 应在 renderer 的销毁生命周期中释放；异步 `create()` 还要检查 `ctx.signal.aborted`。渲染对象不写入文档，离屏后可以安全销毁并从最新 JSON 重建。

### 通用检查清单

- 数据状态放在扁平的 `node.props` 和 `assetRefs`，渲染对象只保存临时状态。
- 每个节点都有 `validate()`、`getBounds()`，并明确自己的 resize policy。
- 多选只操作 `board.selection`；移动、文字提交、媒体创建都通过事务进入历史。
- DOM overlay 只承载编辑交互，提交后立即回写节点并销毁 overlay。
- renderer 实现 `create/update/destroy` 对称生命周期，异步资源使用 lease 和 abort signal。

## Capabilities 与 Agent tools

统一能力层提供 `document`、`nodes`、`assets`、`selection`、`viewport`、`history`、`preview` 和 `capture`。直接调用能力层时，写操作可以带 `origin`，例如 `agent:my-agent`；结果和错误是可序列化的能力契约。

```ts
import { createPixiBoardAgentTools } from "@pixi-board/agent-tools";

const tools = createPixiBoardAgentTools(board.capabilities);
const result = await tools.call("canvas.read", { limit: 50, fields: ["id", "type", "x", "y"] });
await tools.call("canvas.write", {
  type: "create",
  nodes: [{ type: "app.rect", x: 0, y: 0, width: 100, height: 60, props: { fill: 0x52d68e } }],
});
```

`agent-tools` 只提供工具定义、JSON Schema、校验和调用适配，不内置 MCP、HTTP 或 WebSocket server；传输由你的 Agent harness 负责。

## 版本与一致性

这是 alpha SDK。每次升级前请运行项目的 `docs:check`、相关 package tests 和示例测试。发现文档与行为不一致时，先查看 [`api-consistency.md`](api-consistency.md)，再以包的 `exports`、类型报告和测试为准。

## 进一步阅读

- [Vanilla consumer fixture](../../apps/examples-vanilla/README.md)
- [Custom node fixture](../../apps/examples-custom-node/README.md)
- [Desktop SDK fixture](../../apps/examples-desktop-sdk/README.md)
- [公开 API 草案（维护者参考）](../04-public-api.md)
- [自定义节点设计（维护者参考）](../05-custom-node-system.md)
