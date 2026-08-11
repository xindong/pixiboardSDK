# 目标技术架构

## 总览

```text
Desktop App / Web App / Embedded Product
                  │
                  ▼
         Plugin Host / Agent Host
                  │
                  ▼
           BoardCapabilities
                  │
                  ▼
             pixiboardjs
      ┌───────────┼────────────┐
      ▼           ▼            ▼
  Board Core   Pixi Renderer  Runtime Services
      │           │            │
      └──────┬────┘            │
             ▼                 ▼
      Platform-independent   Ports
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
             Browser Adapters     Tauri Adapters
```

## 架构层级

### 1. Board Core

不依赖 DOM、Pixi 或平台 API，负责：

- `BoardDocument` 和 schema version。
- Node/Asset 索引。
- Node Type Definition 数据校验。
- commands、transactions 和 history。
- selection、viewport state 和坐标转换。
- revision、ChangeSet 和 typed events。
- serialization、current-format validation 和 incompatible-format rejection。

Core 可以在没有 renderer 的情况下运行，用于文档检查、Agent 批处理和测试。

### 2. Pixi Renderer

只根据 core snapshot 和 ChangeSet 维护可见 Pixi View：

- Pixi Application 和单一 `world` container。
- NodeRendererRegistry。
- `GridSpatialIndex` 空间索引（均匀网格，默认 cellSize 256）。
- 可见节点和预加载边界查询。
- NodeView create/update/destroy。
- Texture lease、媒体 runtime 和 LOD。
- capture。

Renderer 不保存业务真相。完整 reload 时必须能够只依赖 document、registered node types 和 assets 重建。

Renderer **不包含 overlay container**。selection 轮廓、节点标签、resize handle 和无障碍树都属于 DOM overlay 层（见下），理由是：

- 这些内容是文档的**派生视图**，不进 `BoardDocument`，也不应该占用 Pixi view 预算或参与 culling；
- 文字在 DOM 里由浏览器按物理像素光栅化，任何缩放都保持锐利，而 WebGL 文字要么发糊要么每次缩放重新光栅；
- WebGL canvas 对辅助技术是不透明像素，无障碍能力只能由真实 DOM 元素承载。

代价是 overlay 不会出现在 `capture()` 的输出里——capture 拍的是内容，不是 chrome。若未来出现"选择框必须进截图"这类需求，再单独引入一个不参与 culling 的 Pixi overlay container，属于新增能力而非本层职责回收。

### 3. Runtime Services

把 core、renderer 和外部 ports 组合成可用画布：

- mutation commit pipeline。
- persistence scheduling。
- asset import/preview orchestration。
- input/tools。
- multi-instance focus scope。
- lifecycle 和 capability availability。

### 3.5 DOM Overlay 层

浏览器专属，从 `pixiboardjs/browser` 导出，绝不进入 `core` 或 `renderer-pixi`。它把画布内容投影成真实 DOM 元素，承担三类职责：

| 能力 | 入口 | 驱动源 | 虚拟化窗口 |
|---|---|---|---|
| 通用 overlay 原语 | `attachOverlayLayer` | viewport + changeSet | 视口可见集 |
| 无障碍树 | `attachAccessibilityTree` | changeSet + 焦点 | 焦点邻域 |
| resize handle | `attachDomTransformer` | selection + viewport | 当前选择 |

**两套虚拟化窗口不能合并。** 视觉 overlay 按视口裁剪；无障碍树按焦点裁剪——屏幕阅读器用户没有"视口"概念，只按视口给内容会让文档其余部分对他们永远不存在。共用投影与元素池，但驱动源与窗口独立。

Overlay 的状态是纯派生的：它可以在任何时刻销毁重建，不持有业务真相，与"数据是事实，渲染是缓存"同一条原则。

### 4. BoardCapabilities

为产品 UI、插件和 Agent 提供稳定、受控、高层语义：

- read/filter/project snapshot。
- create/update/delete nodes。
- import/update assets。
- refresh/get preview。
- install generating output。
- capture/export。
- selection/viewport/history 操作。

Capabilities 只调用公共 runtime/service，不访问内部 Store 或 Pixi objects。

### 5. Host 层

不属于主 SDK 核心：

- Desktop/Web 产品 UI。
- 项目切换和用户设置。
- 插件加载、权限、panel dock、process。
- MCP/HTTP/WebSocket transport。
- Tauri dialog、Finder、app lifecycle。

## 扁平文档模型

```ts
export type BoardDocument = {
  schemaVersion: number;
  revision: number;
  nodes: BoardNode[];
  assets: AssetRecord[];
  viewport?: ViewportSnapshot;
  metadata?: Record<string, JsonValue>;
};

export type BoardNode<Props extends JsonValue = JsonValue> = {
  id: string;
  type: string;
  typeVersion: number;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  assetRefs?: Record<string, AssetRef>;
  props: Props;
};
```

约束：

- 不包含 `parentId`、`children` 或 transform inheritance。
- world bounds 可仅根据该节点数据计算。
- `type` 是可注册字符串，不再等于 `AssetKind`。
- asset 通过可选命名 `assetRefs` 引用；node type 是行为与 renderer 定义。
- `props` 必须能通过对应 Node Type Definition 校验。
- zIndex 允许重复，以序列化数组顺序作为稳定 tie-breaker。
- selection 是 session state，不属于 BoardDocument。

## 单一修改管线

```text
NodeHandle / UI / Plugin / Agent
                │
                ▼
          BoardCapabilities
                │
                ▼
       Transaction / Command
                │
        validate + authorize
                │
                ▼
          Document commit
                │
     revision + ChangeSet + history
                │
       ┌────────┼─────────┐
       ▼        ▼         ▼
   Renderer   Events   Persistence
```

任何旁路写入都视为架构违规。

## ChangeSet 契约

```ts
export type BoardChangeSet = {
  transactionId: string;
  revision: number;
  label?: string;
  origin: ChangeOrigin;
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodeIds: string[];
  assetChangedNodeIds: string[];
  selectionChanged: boolean;
  viewportChanged: boolean;
  timestamp: number;
};
```

同一个 ChangeSet 同时服务 renderer、events、persistence、plugins 和 Agent response，避免多套变化描述漂移。

## Renderer 缓存模型

```text
Document: 100,000 nodes
        │
        ▼
Spatial index query(viewport + padding)
        │
        ▼
Visible IDs: 300
        │
        ▼
NodeView cache: about 300-500
```

节点离屏后：

1. 立即隐藏或从 active set 移除。
2. 延迟销毁 View，避免快速来回滚动造成抖动。
3. 释放 texture/media lease。
4. 文档节点保持不变。

## 输入模型

Renderer 将原始 Pixi/DOM 事件转换成 SDK 事件：

```ts
type BoardPointerEvent = {
  nodeId?: string;
  screenPoint: Point;
  worldPoint: Point;
  button: number;
  modifiers: ModifierState;
  pointerId: number;
};
```

输入控制器只对 focused board 响应 keyboard/clipboard。Window 级监听仅用于 pointer drag continuation，并且必须在 destroy 时释放。

## Headless 与 Mounted 模式

| 能力 | Headless Core | Mounted PixiBoard |
|---|---:|---:|
| 文档 CRUD | 支持 | 支持 |
| history/transaction | 支持 | 支持 |
| JSON validate/reject incompatible format | 支持 | 支持 |
| Agent read/write | 支持 | 支持 |
| 选择与 viewport state | 支持 | 支持 |
| hit test | 不支持 | 支持 |
| capture | 不支持 | 支持 |
| texture/video preview | 不支持 | 支持 |

Agent 工具必须能报告 capability unavailable，而不是假设 renderer 永远存在。
