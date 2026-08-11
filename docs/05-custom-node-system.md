# 自定义节点系统

## 目标

用户无需修改 core union、Store 或 `nodeView.ts` 即可注册新节点。内置 image、video、audio、text、markdown、html、draw 和 generating 节点必须通过相同机制实现，避免“官方节点是特例、第三方节点是补丁”。

## 两部分契约

自定义节点分为数据定义和 Pixi 渲染定义：

```text
NodeTypeDefinition<Props>       PixiNodeRenderer<Props, ViewState>
  type                            create
  version                         update
  defaults                        destroy
  validate                        optional hitTest
  getBounds                       optional capture
```

Core 只认识前者；renderer-pixi 认识后者。

主包提供受控的组合注册便利 API：`await board.nodeTypes.register()` 接受 public `CustomNodeDefinition`（数据定义以及可选 `renderer` 字段），内部仍分别写入 Core registry 和 renderer registry。注册 Promise 只在可见节点 refresh 完成后 resolve，避免 ready 后注册产生静默 race；返回的 async disposer 同时注销并刷新两侧。public facade 不支持 `replace: true`，需要先 dispose 当前定义再注册，避免 refresh 失败时无法恢复旧定义。公开类型由 `pixiboardjs` 自身定义，不在 `.d.ts` 中引用内部 renderer 包，也不会向调用方暴露 Pixi scene、Store 或全局 texture cache。

## 数据定义

```ts
export type NodeTypeDefinition<Props> = {
  type: string;
  version: number;
  defaults?: Partial<Props>;
  validate(value: unknown): Props;
  getBounds(node: BoardNode<Props>): WorldBounds;
  resize?: ResizePolicy<Props>;
};
```

Node definition 只验证当前 `typeVersion`。版本不匹配时明确拒绝；SDK 不调用 node data migration callback，也不为旧 node props 提供 legacy adapter。

### Type 命名

- 内置类型使用 `media.image`、`media.video`、`document.markdown` 等命名空间。
- 第三方推荐 `vendor.plugin-name.node-name`。
- 同一 runtime 中 type 必须唯一。
- 重复注册默认抛错；开发模式可提供显式 `replace: true`，生产模式禁止无版本热替换。

### Bounds 是硬要求

`getBounds()` 不能依赖 Pixi View，因为 View 可能尚未创建或已被离屏销毁。Core/renderer 需要纯数据 bounds 完成：

- 空间索引。
- 视口 culling。
- 框选和 fitNodes。
- selection overlay。
- node/bounds capture 准备。

默认实现可使用节点的旋转矩形；特殊节点可覆盖。

## Pixi Renderer 定义

```ts
export type PixiNodeRenderer<Props, ViewState> = {
  create(
    node: ReadonlyBoardNode<Props>,
    context: PixiNodeRendererContext,
  ): PixiNodeView<ViewState> | Promise<PixiNodeView<ViewState>>;

  update(
    view: PixiNodeView<ViewState>,
    node: ReadonlyBoardNode<Props>,
    context: PixiNodeRendererContext,
  ): void | Promise<void>;

  destroy(
    view: PixiNodeView<ViewState>,
    context: PixiNodeRendererContext,
  ): void;

  hitTest?(
    node: ReadonlyBoardNode<Props>,
    worldPoint: Point,
  ): boolean;
};
```

Renderer context 提供受控能力：

```ts
type PixiNodeRendererContext = {
  assets: {
    acquireTexture(ref: AssetRef, options?: TextureRequest): Promise<TextureLease>;
  };
  invalidate(): void;
  signal: AbortSignal;
  lod: NodeLodContext;
  diagnostics: RendererDiagnostics;
};
```

不提供完整 BoardStore、BoardScene 或全局 TextureCache。

## 生命周期

```text
节点进入预加载区域
        │
        ▼
      create
        │
文档或 LOD 变化 ──> update
        │
离屏超过保留时间 / 删除 / renderer 重载
        │
        ▼
      destroy
```

要求：

- create/update 可异步，但必须响应 AbortSignal。
- 每个 View 有 generation/version，旧异步结果不能覆盖新数据。
- destroy 必须释放事件、ticker、media、texture lease 和 children。
- 再次进入视口时，只凭最新 JSON 和 assets 可重建相同业务表现。

## 状态边界

允许只存在 View 的临时状态：

- Sprite、Graphics、Text 实例。
- texture lease。
- hover、过渡动画进度。
- 正在播放的媒体 runtime。
- 缓存的测量结果。

必须写回 `node.props` 的状态：

- 标题、进度、业务状态。
- 用户配置。
- 应在保存和重启后恢复的内容。
- Agent 或插件需要读取的内容。

## 示例

```ts
await board.nodeTypes.register<TaskCardProps>({
  type: "acme.task-card",
  version: 1,
  validate: validateTaskCard,
  getBounds: rotatedRectBounds,
  renderer: {
    create(node) {
      const root = new Container();
      const background = new Graphics();
      const title = new Text();
      root.addChild(background, title);
      return { displayObject: root, state: { background, title } };
    },
    update(view, node) {
      view.displayObject.position.set(node.x, node.y);
      view.state.title.text = node.props.title;
      drawTaskBackground(view.state.background, node);
    },
    destroy(view) {
      view.displayObject.destroy({ children: true });
    },
  },
});
```

## 未注册节点类型

加载文档时不能丢弃未知节点。默认策略：

- 保留原始 JSON。
- 使用 `unknown-node` placeholder 显示 type、ID 和 bounds。
- 禁止编辑 props，但允许移动、删除和重新注册后刷新。
- 发出 `node-type:missing` 事件。

注册对应类型后，renderer 应能对当前可见未知节点执行重建。

## Resize 与选择

第一版提供有限策略：

```ts
type ResizePolicy<Props> =
  | { mode: "free" }
  | { mode: "aspect-ratio"; ratio?: number }
  | { mode: "fixed" }
  | { mode: "custom"; resize(input): NodePatch<Props> };
```

策略在 `nodeTypes.register()` 时校验：未知 mode、`custom` 缺少 `resize()`、`aspect-ratio` 声明非正 ratio 都直接抛 `NodeValidationError`，不接受运行期才暴露的错误定义。

未声明 `resize` 的节点类型按 `free` 处理；`node.locked === true` 覆盖任何策略，一律拒绝改动几何。

### 求解与提交

Core 提供两层入口：

- `resolveResize(node, policy, request)` — 纯函数，把一次手柄拖拽换算成 `BoardNodePatch`，包含策略求解与重新锚定。
- `board.nodes.resize(nodeId, request)` — 走同一求解并提交 transaction。策略拒绝时返回原节点且不产生 revision，避免在 fixed 节点上拖拽每帧提交空事务。

`request.deltaWorld` 是世界坐标下的累计位移，`request.origin` 是 pointerdown 时刻的几何。按 origin 累计而非按当前尺寸递推，长距离拖拽不会累积舍入误差。

旋转节点在自身坐标系内求解：delta 先反向旋转到 local frame，再沿节点自己的轴增长，手柄未占用的边保持世界位置不变。

### 选择框与控制点

主包提供 `board.transform`：

```ts
board.transform.bounds();          // 选区世界矩形，单选时带 rotation
board.transform.handles();         // 八个控制点的世界坐标与 CSS cursor
const session = board.transform.begin("se");
session.update({ x: dx, y: dy });  // 累计位移，可每帧调用
session.commit();                  // 或 session.cancel() 还原
```

一次手势内的每帧都是独立 revision 与 ChangeSet（renderer 与观察者看到实时几何），但共享同一个 `coalesceKey`，在 history 里合并为单个 undo step（见 ADR 0006）。

多选没有共享 rotation，选区框取所有节点旋转后角点的轴对齐包围盒；缩放时按同一比例映射每个节点的偏移与尺寸，但每个节点的尺寸仍各自过自己的 ResizePolicy——多选中的 fixed 节点保持原尺寸与原位置，不随组缩放漂移。

浏览器宿主可直接用 `pixiboardjs/browser` 的 `attachDomTransformer()` 渲染这八个控制点。控制点必须是真实 DOM 元素而非 `::before/::after`：伪元素永远不会成为 `event.target`，只能被样式化、无法被抓取。自定义 outline 与旋转中心标记仍为后续 experimental，不阻塞 v1。

## 性能约束

自定义 renderer 不应：

- 在每帧创建大量 DisplayObject。
- 自己绕过 asset/texture lease。
- 注册无法在 destroy 中移除的全局监听。
- 把业务状态只存入 Pixi object。
- 对每次 update 全量解析大文件。

开发模式 diagnostics 应记录 create/update/destroy 耗时、active views、lease 和迟到异步更新。

## 验收样例

`custom-task-card` 示例必须验证：

1. 创建、更新、保存、重载。
2. undo/redo。
3. selection、resize、fitNodes。
4. 离屏销毁，回屏重建。
5. Agent read/write props。
6. 未注册时 placeholder，注册后恢复。
