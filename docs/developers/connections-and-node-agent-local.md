# 连线与节点 Agent

公开入口为 `pixiboardjs/browser`，从 `0.1.0-alpha.5` 起提供。关系仅存放在当前文档的 `metadata.connections`，节点类型与 Agent 服务由宿主提供。

## 连线

```ts
import { attachConnections } from 'pixiboardjs/browser'

await board.ready
const connections = await attachConnections(board, {
  surface: canvasHost,
  overlay: canvasHost.parentElement!,
  enabled: true,
  persistSettings: false, // 宿主全局偏好不进入文档撤销历史
  style: { startColor: '#8b9cba', endColor: '#526de0', width: 1.8 },
})
connections.create(sourceNodeId, targetNodeId)
connections.incoming(targetNodeId)
connections.getNeighborIds(sourceNodeId, 'outgoing')
connections.setStyle({ lineType: 'dashed', startOpacity: 0.5 })
```

关系是 `document.metadata.connections: {id, source, target}[]`，仅保存一份；核心 metadata 补丁参与事务、撤销/重做，删除节点同时清理关系。运行时维护邻接表和节点/线段空间索引，节点改变只刷新关联线，视口变换复用 world 容器。Pixi 连线层位于节点后方；渐变按弧长绘制，支持实线/虚线/点线。节点截图不带外部连线。

`copyWithin(ids)` 提取选区内部边；在创建新节点的同一事务内调用 `pasteWithin(edges, oldToNewIds)`，同时撤销节点和关系。示例站点通过可选的 `configureSiteConnections(controller)` 接入这一能力。

只接受 `{id, source, target}` 关系；不读取节点 props 中的关系字段。

关闭渲染后数据仍可通过 `list/incoming/outgoing` 查询；`getNeighborIds` 返回空供宿主关闭隐式 Agent 关系上下文。

## 节点 Agent

```ts
import { createNodeAgentController } from 'pixiboardjs/browser'
const agent = createNodeAgentController(board, {
  enabled: true,
  context: { scope: 'upstream', maxNodes: 20, maxChars: 24000 },
  getNeighborIds: (id, direction) => connections.getNeighborIds(id, direction),
  beforeSubmit: hostFlushPendingChanges,
  resolveAsset: hostResolveAsset,
  buildPrompt: hostBuildPrompt, // 可省略以使用通用构建器
  onSubmit: hostSend,
})
await agent.submit({ boardId, nodeId }, instruction)
```

`prepare()`、`submit()`、`cancel()`、`configure()`、`destroy()` 分离上下文、提示词与传输。节点内容按参考资料组织，图遍历使用 visited 和节点/字符/资源预算；异步准备时目标失效、被取消、或文档改变会拒绝过期结果。

DSH 保留节点输入框、保存队列、资源 URL、当前对话定位和消息回执，使用 SDK 的上下文及提示词构建钩子；SDK 不包含 DSH session 或网络服务地址。

## 节点类型转换与浏览器宿主

`board.nodes.convert(id, { type, props, assetRefs })` 保留节点 ID 和未覆盖的几何信息，替换类型与内容，连线继续引用同一 ID。转换支持事务及撤销/重做。

高级浏览器宿主可从同一 `pixiboardjs/browser` 入口导入 `NodeTypeRegistry`、`rotatedRectBounds`、`createPixiApplicationFactory`、`loadPixiRuntime` 和 `PixiBoardRenderer`。DSH 以此加载 npm 发布包，不依赖私有 workspace 包。

## 验证与发布

本机不执行前端构建或类型检查；PR 使用仓库现有 CI。合并后通过 npm release artifacts 工作流生成发行包与 API 报告，执行既有发布门禁，再从同一 SHA 的 tarball 发布 npm。
