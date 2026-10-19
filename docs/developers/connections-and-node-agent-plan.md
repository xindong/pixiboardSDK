> 实现已落地：使用方式见 [连线与节点 Agent](connections-and-node-agent-local.md)。以下保留设计背景，发布行为以 README 和包版本为准。

# SDK 连线与节点 Agent 能力实施范围

状态：目标设计与实施约定。2026-10-15。

本地实现现状与实际 API 见 [本地开发 API](connections-and-node-agent-local.md)。发布流程按用户后续要求延后，本轮仅本地 SDK 源码联调。下文仍是目标设计，不作为全部验收已完成的声明。

## 产品目标与交付边界

SDK 面向 AI 友好的通用画布。此次交付两项可选能力：高性能定向连线、节点 Agent 上下文与提示词构建。由 pixiboardjs 暴露公开 API；DSH 仅配置能力、解析自己的资源并发送给当前对话。保持扁平节点模型，不引入场景树。

本轮授权范围包含 SDK 实现、预发布版本发布、DSH 接入和旧数据迁移。本文用于将需求整理为可执行的范围，不代表上述步骤已完成。

## 一、连接能力

- 独立 Connection 集合为唯一关系事实，source/target 引用 nodeId 与端口。
- 端口当前约束 right → left，保留端口标识以允许未来扩展；不在本轮实现任意端口编辑。
- from/to 是由连接索引导出的节点关系视图，不与连接集合重复持久化。
- 公开 connect/disconnect/updateStyle/list/incoming/outgoing；增加、删除、端点联动、节点删除与连接清理进入核心事务/补丁/历史。
- 节点复制时复制选区内部连接并重映射 ID；默认不复制跨选区边。
- 配置 enabled，运行时切换：关闭后不画连线/端口、不接受连线编辑、不将隐含关系注入 Agent；连接数据与查询保留，重新开启恢复。默认关闭，避免改变现有接入方行为；DSH 显式开启。
- Pixi world 下设置 connectionLayer 和 nodeLayer，连线真实位于节点下方；端口与拖线交互通过已有 overlay 能力实现。
- 世界坐标计算曲线，节点移动仅更新关联连接，视口平移主要更新容器变换与可见集。拖拽一帧合并一次工作。
- 维护 nodeId→edgeIds 邻接索引及连接空间索引。曲线包围盒/分段范围用于裁剪，不能仅按端点可见性判断；粗筛后按到曲线距离精确命中。
- 保留三次贝塞尔、右侧 hover 小端口、整节点投放、两端贴边、无箭头、渐变颜色/不透明度、线宽/线型及样式编辑器。
- 复用现有导出管线，把连线层纳入整画布/区域导出；单节点导出默认不带外部连接。
- 先复用 Pixi 渲染基础设施；是否采用专用 Mesh/细分缓存与合批以测量结果决定，不预设帧率/节点数承诺。

## 二、节点 Agent 能力

分离 context → prompt → submit，配置和状态不可写入文档中的可执行代码。

1. collectContext：构建带 schemaVersion、boardId、revision、nodeIds 的结构化快照，包含选中节点、必要资源描述和明确配置的连接关系。
2. buildPrompt：默认构建器提供可读提示词及结构化上下文；可配置系统说明、上下文字段、资源描述、格式与完整自定义函数。构建器不访问 DSH 服务。
3. onSubmit：宿主接收 requestId、instruction、context、prompt、resources、AbortSignal；发送到指定对话/Agent/HTTP 服务。SDK 不固化模型、供应商、session 或 transport。
4. beforeSubmit/prepareContext：宿主可在采集最终快照前等待保存、解析资源；SDK 管理异步期间目标变更、取消与过期结果。DSH 继续沿用有界保存重试，但保存逻辑留在 DSH。
5. resolveAsset：可选宿主回调，按需解析文本、预览图或原文件引用；不把本机路径、DSH URL 或鉴权令牌写死进 SDK。保持资源引用与提示词文本分离，支持未来多模态宿主。
6. UI 可单独开启：节点操作入口、输入框、发送中、错误重试与取消；无头 API 可供外部面板使用。开启 UI 但缺少 onSubmit 时明确禁用提交，不显示虚假的成功。
7. 默认仅包含当前节点及其引用资源。上游/下游上下文需显式开启，设跳数、节点数、字符/资源预算，循环图用 visited 去重，超限返回截断说明。
8. 用户指令和节点内容分开表达；节点文本是上下文资料，不自动升级为系统指令。不自动执行 AI 返回的画布修改。
9. 可查看最终组装提示词，便于接入方和用户诊断；成功/失败含义由 onSubmit 返回契约定义，不把请求受理当作模型执行完成。
10. AI 能力与连接独立开关；关闭连线仍可对单节点执行 Agent 操作。配置指定的显式连接上下文不依赖视觉显示，应通过单独 scope 参数决定。

## 建议配置形态（示意，非现有 API）

```ts
const board = await createBoard({
  connections: { enabled: true },
  nodeAgent: {
    enabled: true,
    ui: true,
    context: { scope: 'node', maxNodes: 20, maxChars: 24000 },
    buildPrompt: defaultPromptBuilder, // 可省略或覆盖
    resolveAsset: hostResolveAsset,
    beforeSubmit: hostFlushPendingChanges,
    onSubmit: async ({ prompt, context, resources, signal }) => {
      return hostSend({ prompt, context, resources, signal })
    },
  },
})
board.connections.setEnabled(false) // 数据保留
```

开关关闭时的视觉与上下文策略：视觉关闭不删除关系。Agent 默认不读取邻居；宿主显式选择关系 scope 时仍可查询保留的连接数据，不将 UI 开关混同于数据权限。

## 复用与迁移

当前代码事实：SDK renderer.ts 有 changeSet 增量应用与 GridSpatialIndex；overlay-layer.ts 有元素池与动画帧合并；Core 提供事务/历史/节点 CRUD，但无连接集合及连接补丁。当前 DSH connections.js 使用 SVG 全量重建与遮罩，节点类型校验器经 withConnections 保留关系字段。node-agent.js 管理资源快照、保存与选区校验；src/client.js 的 buildNodeAgentPrompt 硬编码 DSH 指令与资源 URL。

可复用：交互规则、曲线计算、样式字段及校验、UI、SDK overlay/viewport、Core 事务/历史、渲染增量流程与空间索引接口。
替换：全量 SVG、节点遮罩、DOM 透明命中线、定时检查活动画布、覆写 CRUD 的插件补丁。
宿主保留：DSH 保存队列、资源 URL/鉴权、postMessage 来源校验、session 定位和 conversation.send。

旧数据迁移：备份原文档，校验双端索引，稳定生成连接 ID，将 source.props.connectionStyles[targetId] 搬到 Connection；去重、丢弃悬空端点并报告；写入迁移版本，重复加载不重复生成。完成新文档写入后不再双写 props.from/to。正常文档加载和导出支持 schema 版本迁移，不依赖 UI 首次挂载写数据。

## 实施顺序与验收

1. Core 连接模型/索引/命令/事务/文档迁移。
2. Pixi 增量渲染、空间命中、原生层级和截图导出；端口 overlay 与样式 UI。
3. 独立 Node Agent context/prompt/submit 契约、默认构建器与可选 UI。
4. DSH 改为少量配置接入，移除旧实现；验证节点连线与 Agent 操作、开关关闭/恢复、保存重载、撤销/复制/删除及旧数据迁移。
5. 按公开包 API/版本流程发布下一可用 alpha 版本，确认 registry 可安装后将 DSH 固定到发布版本及不可变源码 SHA，重启并交付。

性能验收区分冷启动、可见边/总边、批量导入和高连接度节点；比较移动一个节点时实际更新边数、平移时几何重建数、命中候选数、内存、帧耗时。不得以新增 O(E) 全量扫描替代邻接更新。前端不运行本机构建/类型检查；发版产物和必要验证遵循本会话约定，不能把未验证结果报告为通过。
