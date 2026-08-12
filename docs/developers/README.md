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
