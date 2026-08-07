# ADR 0001：采用扁平文档模型

- Status: Accepted
- Date: 2026-08-07

## Context

PixiBoardJS 面向大型媒体工作流，而不是通用矢量场景图。现有 Pixi Board 文档已经是扁平资产节点数组，空间索引、虚拟化、Agent 查询和批量写入都建立在节点拥有独立 world bounds 的前提上。

## Decision

SDK v1 的 `BoardDocument.nodes` 保持扁平：

- 不引入 `parentId`、`children`、Group 或 transform inheritance。
- 每个节点拥有独立 world position、size、rotation 和 zIndex。
- 一个复杂自定义节点内部可以使用 Pixi children，但对文档仍是一个节点。
- 逻辑关联可通过 props、tags、relation 数据或应用层模型表达，不改变 renderer 场景结构。

## Consequences

收益：

- bounds、空间索引和 culling 简单明确。
- Agent read/write 和序列化结构稳定。
- 不需要递归 transform、事件冒泡和层级 reorder。
- 更容易保证海量稀疏节点性能。

代价：

- 不提供 Konva 风格 Group/children。
- 多节点组合移动需要应用层批量 transaction。
- 不适合作为通用矢量设计器的完整底座。

如果未来需要通用场景树，应作为新产品阶段和新的 major architecture decision，不在 v1 增量加入半套树模型。

