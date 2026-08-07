# ADR 0005：文档序列化、资产引用、层级与选择状态

- Status: Accepted
- Date: 2026-08-07

## Decision

- `nodes` 在 JSON 中使用数组，保证可读性、稳定 round-trip 和顺序表达；运行时建立 `Map<string, Node>` 与顺序索引。
- 节点使用可选命名资产引用：

```ts
assetRefs?: Record<string, AssetRef>;
```

- 当前格式只接受命名 `assetRefs`；不转换旧 `assetId`。自定义节点可以没有资产，也可以引用多个资产。
- `props` 只保存节点类型业务数据，不承担通用资产生命周期协议。
- `zIndex` 允许重复，使用序列化数组顺序作为稳定 tie-breaker；reorder API 在显式调用或稠密度达到阈值时规范化。
- Selection 不属于 `BoardDocument`。它是 session/runtime state，可由宿主单独选择是否保存。

## Consequences

- 文档保持简单且适合 Agent/版本控制阅读。
- 运行时查询和修改不依赖数组扫描。
- 多素材节点不需要把资产协议塞进任意 props。
- selection 变化不会污染文档 revision 和协作语义。
