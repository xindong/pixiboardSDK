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
- serialization、validation 和 migrations。

Core 可以在没有 renderer 的情况下运行，用于文档检查、Agent 批处理和测试。

### 2. Pixi Renderer

只根据 core snapshot 和 ChangeSet 维护可见 Pixi View：

- Pixi Application 和内部 world/overlay containers。
- NodeRendererRegistry。
- RBush 空间索引。
- 可见节点和预加载边界查询。
- NodeView create/update/destroy。
- Texture lease、媒体 runtime 和 LOD。
- selection overlay、labels、capture。

Renderer 不保存业务真相。完整 reload 时必须能够只依赖 document、registered node types 和 assets 重建。

### 3. Runtime Services

把 core、renderer 和外部 ports 组合成可用画布：

- mutation commit pipeline。
- persistence scheduling。
- asset import/preview orchestration。
- input/tools。
- multi-instance focus scope。
- lifecycle 和 capability availability。

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
| JSON validate/migrate | 支持 | 支持 |
| Agent read/write | 支持 | 支持 |
| 选择与 viewport state | 支持 | 支持 |
| hit test | 不支持 | 支持 |
| capture | 不支持 | 支持 |
| texture/video preview | 不支持 | 支持 |

Agent 工具必须能报告 capability unavailable，而不是假设 renderer 永远存在。
