# ADR 0013：保留节点身份的显式内容转换

- Status: Accepted
- Date: 2026-10-16

## Context

DSH 需要让 Agent 在长任务开始时创建 processing 占位节点，在结果就绪后原位转换为图片等节点。用户等待期间可能移动、缩放和连接该节点。删除后重建会丢失这些关联；普通 update 则明确禁止修改 type。

## Decision

- 在 Core 与 `pixiboardjs` facade 提供 `nodes.convert(nodeId, input)`，input 为 `BoardNodeConvertInput`，要求目标 type。
- 保留节点 ID，以及没有显式覆盖的空间属性、锁定和可见状态；连线仍按相同 ID 引用。目标类型必须注册。
- 使用目标类型的默认值、验证器和版本创建 props；旧 props、assetRefs、name 及其他内容扩展字段不继承。可在 input 中显式提供新值。
- 转换使用现有 `node:replace` 正向和逆向补丁，作为一个可撤销事务。渲染器在 type 或 typeVersion 改变时重新创建视图并释放旧资源。
- processing 为宿主注册的正常节点类型；SDK 不绑定生成工具、任务 ID、轮询、取消或超时语义。DSH 使用同一个 canvas_write 的 convert 操作暴露此能力。
- 这是当前 Document 内明确执行的内容转换，不是旧文档格式迁移，不改变 ADR 0011。

## API

```ts
board.nodes.convert('cat-result', {
  type: 'image',
  assetRefs: { primary: { assetId: 'cat-asset', variant: 'original' } },
  props: { name: 'cat.png', mimeType: 'image/png', size: 1024 },
})
```

实现落点：`packages/core/src/core.ts` 的 BoardNodesController.convert、`packages/pixiboardjs/src/index.ts` 的公开 facade、`packages/renderer-pixi/src/renderer.ts` 的视图协调。DSH 文件导入与 processing 外观保留在宿主适配层。

公开于 `0.1.0-alpha.5`。本地不运行前端构建或类型检查；发行产物在合并后的 CI 工作流生成。
