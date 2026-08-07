# 产品目标与范围

## 一句话目标

PixiBoardJS 是面向大型媒体与 AI 工作流的高性能无限画布 SDK：使用扁平、可序列化的数据模型表达文档，以 PixiJS 场景作为按视口创建和销毁的渲染缓存，并向网页、Tauri 应用、插件和 Agent 提供统一能力。

## 目标用户

- 需要在网页或 WebView 中嵌入无限画布的产品团队。
- 需要承载图片、视频、音频、文本、Markdown、HTML、SVG、模型预览和生成中节点的媒体工具。
- 需要通过插件扩展面板、工具、节点类型和工作流的宿主应用。
- 需要让 Agent 安全读取、创建、更新、删除和预览画布内容的 AI 产品。
- 需要在文档节点很多、但屏幕可见节点有限时保持稳定性能的应用。

## 核心价值

1. **大型稀疏画布性能**：运行成本主要随可见节点和活跃媒体增长，而不是随文档总节点数线性增长。
2. **数据优先**：节点是纯 JSON，任何渲染对象都可销毁重建。
3. **可嵌入**：同一个 SDK 可运行在现代浏览器和 Tauri WebView。
4. **可扩展**：内置节点和自定义节点使用同一注册机制。
5. **可自动化**：人类交互、插件和 Agent 写入汇入同一个 transaction/command pipeline。
6. **渐进迁移**：现有 Pixi Board 桌面应用按阶段切换为 SDK 消费者，不进行一次性重写。

## 明确范围

### SDK v1 必须支持

- 扁平节点文档与 schema version。
- 节点 CRUD、查询和批量 transaction。
- 选择、视口、撤销重做和 typed events。
- PixiJS 渲染、空间索引、视口虚拟化和纹理生命周期。
- Node Type Registry 与自定义 Pixi 节点 renderer。
- 内置媒体节点通过相同 registry 注册。
- Web 和 Tauri 的资产、持久化适配接口。
- BoardCapabilities：供 UI、插件和 Agent 使用的统一受控能力。
- 文档 JSON 导入导出和迁移。
- viewport/node/bounds 截图。
- 多实例输入隔离和完整 destroy 生命周期。
- 可重复性能 benchmark 和最小示例。

### SDK v1 不做

- Konva 兼容层。
- 通用 `Stage/Layer/Group/Shape/children` 场景树。
- 任意深度父子节点和 transform 继承。
- 完整矢量设计工具替代品。
- 原生 iOS/Android 或非 WebView 桌面 renderer。
- 实时多人协作协议。
- 把插件 zip、MCP server、项目切换和产品 UI 打入主 SDK。
- 第一阶段公开所有内部 workspace package。

## 设计原则

### 数据是事实，渲染是缓存

任何可持久状态必须存在于 `BoardDocument`。Pixi Container、Sprite、Texture、HTMLMediaElement 和临时动画状态都不能成为文档真相。

### 单一写入通道

用户交互、公共 API、插件和 Agent 的修改都必须进入 transaction/command pipeline。禁止直接修改 Store 内部对象。

### 核心不感知平台

Core 不导入 DOM、Pixi、Tauri、Node.js 文件系统或插件 SDK。平台能力以 port/adapter 注入。

### 高级能力不污染最小路径

Three.js 模型预览、HTML 文档栅格化、视频运行时、插件宿主和 MCP 应按需加载，不进入空白画布的必要启动路径。

### 一个产品包，多个内部边界

普通用户只需安装 `pixiboardjs`。内部包用于维护依赖方向和测试隔离，不把内部复杂度转嫁给用户。

## 成功标准

- 现有桌面应用不再直接实例化内部 Store/Scene，而是通过 `createPixiBoard()` 运行。
- `canvas.read`、`canvas.write` 和插件 board capability 不再依赖 `MediaWhiteboard` 私有实现。
- 新自定义节点不需要修改 core union 或 `nodeView.ts` 条件分支。
- 10k、50k、100k 节点 benchmark 可重复运行并输出 frame time、内存、view 和 texture 指标。
- 网页示例可以导入 File/Blob、保存、刷新后恢复并导出。
- 多个画布实例不会抢夺快捷键、剪贴板或 pointer 状态。
- SDK 的公开 API 有稳定版本、迁移说明和兼容测试。

