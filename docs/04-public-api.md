# 公共 API 设计草案

## 创建与生命周期

```ts
import { createPixiBoard } from "pixiboardjs";
import { indexedDbPersistence } from "pixiboardjs/browser";

const board = await createPixiBoard({
  container: document.querySelector("#board")!,
  persistence: indexedDbPersistence({ database: "my-board" }),
  interactions: {
    pointer: true,
    keyboard: true,
    clipboard: true,
  },
});

await board.ready;
board.focus();
await board.destroy();
```

生命周期状态：

```text
created -> mounting -> ready -> destroying -> destroyed
```

所有异步任务必须绑定实例 AbortSignal，destroy 后不得继续更新文档或 renderer。

## Node API

```ts
const node = await board.nodes.create({
  type: "media.image",
  x: 100,
  y: 100,
  width: 640,
  height: 360,
  assetRefs: { primary: { assetId: "asset-1", variant: "preview" } },
  props: { objectFit: "contain" },
});

board.nodes.update(node.id, {
  x: 240,
  rotation: 12,
});

board.nodes.remove(node.id);
board.nodes.get(node.id);
board.nodes.list({ type: "media.image", visible: true });
```

### NodeHandle

为提供类似 Konva 的体验，返回 ID-based handle：

```ts
const node = board.node("node-1");

node.x();
node.x(200);
node.setAttrs({ width: 800, height: 450 });
node.getAttrs();
const off = node.on("change", listener);
node.remove();
```

`NodeHandle` 只保存 board reference 和 node ID。`getAttrs()` 返回 immutable snapshot；setter 内部调用 transaction，绝不暴露 Store 或 Pixi View。v1 的 handle 事件只承诺 `change`；pointer/gesture 输入仍由 scoped interactions 处理，在有正式命中测试事件契约前不伪装成 Konva 事件 API。

## Transactions

```ts
board.transaction("Arrange generated assets", () => {
  board.nodes.update("a", { x: 0, y: 0 });
  board.nodes.update("b", { x: 720, y: 0 });
  board.nodes.update("c", { x: 0, y: 480 });
}, {
  origin: "api",
});
```

transaction callback 必须同步执行；传入 async callback 会以 `TransactionConflictError` 拒绝，避免 callback 在回滚后继续写入。返回值就是 callback 的同步返回值。

语义：

- 一个 revision。
- 一个 history entry。
- 一个 ChangeSet。
- 一次 persistence schedule。
- renderer 可合并更新。
- transaction 内任一步校验失败时整体不提交。

## Selection

```ts
board.selection.get();
board.selection.set(["a", "b"]);
board.selection.toggle("c");
board.selection.clear();

board.selection.onChange((event) => {
  console.log(event.nodeIds);
});
```

Selection 默认是运行时状态，可由 persistence policy 决定是否保存，不进入 node 数据。

## Viewport

```ts
board.viewport.get();
board.viewport.set({ scale: 1, offset: { x: 0, y: 0 } });
board.viewport.panBy(120, 0);
board.viewport.zoomAt({ x: 400, y: 300 }, 1.2);
board.viewport.fitNodes(["a", "b"]);
board.viewport.fitBounds(bounds);
board.viewport.toWorld(screenPoint);
board.viewport.toScreen(worldPoint);
```

## History

```ts
board.history.canUndo();
board.history.canRedo();
board.history.undo();
board.history.redo();
board.history.clear();
```

History 内部保存数据化 forward/inverse patches；public contract 只承诺可观察结果，不把内部 patch 固化为协作协议。

## Events

```ts
const off = board.on("change", (event) => {
  console.log(event.revision, event.changeSet);
});

board.on("selection:change", listener);
board.on("viewport:change", listener);
board.on("assets:change", listener);
board.on("history:change", listener);
board.on("capability:change", listener);
```

事件顺序：

1. document commit 成功。
2. revision 更新。
3. 同步 core listeners。
4. renderer 接收 ChangeSet。
5. persistence 被调度。
6. public change event 发出。

Mounted runtime 另发 `render:complete`，包含已应用的 `revision` 和 `frameId`。该事件表示 renderer 已同步该 revision 并完成一次 render pass，不承诺 GPU 已物理显示；`change` 只表达 document commit。

## Document

```ts
const snapshot = board.document.snapshot();
const json = board.document.toJSON();

await board.document.load(json, {
  replaceHistory: true,
});

board.document.validate(json);
```

snapshot 必须是不可变视图或结构化克隆，外部修改不能影响内部状态。

`load()` 和 `validate()` 只接受当前 SDK 定义的 `BoardDocument` 格式。旧 snapshot、schema-v4、旧项目目录或其他 legacy shape 必须返回明确的 `DocumentValidationError`，不得通过 adapter 或隐式转换进入 Core。

## Capture

```ts
await board.capture({ target: "viewport", format: "png" });
await board.capture({ target: "node", nodeId: "a", format: "png" });
await board.capture({ target: "bounds", bounds, scale: 2 });
```

Headless 模式调用 capture 返回明确 `CapabilityUnavailableError`。

## 查询

第一版以结构化 filter 为主：

```ts
board.nodes.list({
  ids: ["a", "b"],
  types: ["media.image", "task-card"],
  bounds,
  selected: true,
  limit: 100,
});
```

可以提供轻量便利 API：

```ts
board.findOne("#node-id");
board.find({ type: "task-card" });
```

不实现 Konva selector 全兼容。

## Errors

公开错误至少包括：

- `BoardDestroyedError`
- `NodeNotFoundError`
- `NodeTypeNotRegisteredError`
- `NodeValidationError`
- `DocumentValidationError`
- `AssetUnavailableError`
- `CapabilityUnavailableError`
- `PermissionDeniedError`
- `TransactionConflictError`

插件和 Agent adapter 将这些错误映射为用户友好、可序列化的结果。

## 不公开的内部对象

- Pixi `Application`、`Container` 和 `TextureCache`。
- mutable `BoardStore`。
- `BoardScene` 私有同步方法。
- Repository 具体实现。
- history 内部 forward/inverse patch 格式。

高级 Pixi 自定义节点通过受控 renderer context 获得必要能力，而不是获取全局 scene。
