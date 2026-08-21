# Site 功能复刻实施计划

目标：`apps/site` 从 SDK showcase 逐步变成 PixiBoard 主应用的浏览器版复刻。插件体系不纳入复刻范围；插件入口 UI 隐藏，不实现插件市场、插件面板和 MCP 插件贡献。

## 复刻范围拆分

### Site 应用层负责

- 第一屏 shell 与桌面应用一致：全屏画布、左侧导入/截图工具 rail、右上项目切换器、左下状态/缩放、导入锁定遮罩。
- 浏览器项目系统：IndexedDB 多画布、当前画布切换、新建、重命名、删除、导出 JSON、清理未用资源、清空本地存储。
- 浏览器文件入口：点击导入、拖放导入、粘贴文件/图片/文本；支持 image/video/audio/model/html/svg/md/txt 以及兜底文件卡片。
- 站内 viewer/player：图片、HTML、Markdown、文本、模型查看；video/audio 播放浮层；选中 video/audio 后提供内联播放控制。
- 临时预览生产：图片缩略图、视频 poster、音频 waveform、文档卡片、模型投影卡片。
- 桌面端插件体系的空缺处理：隐藏插件入口；不接插件贡献的上下文菜单、选择面板 action 或独立 panel layer。

### SDK / 通用包应下沉

- Browser asset runtime：统一 File/Blob/Text/URL 导入，原始文件与 derivative 存储，object URL lease 生命周期。
- Preview pipeline：image、video poster、audio waveform、text/markdown/html/file card、model placeholder/thumbnail 的可复用生成器。
- 内置媒体节点定义和 renderer：image/video/audio/model/html/markdown/text-file/file 不应长期由 site 私有注册。
- Media runtime API：video/audio 的 play/pause/seek/duration/currentTime/subscribe，最终替代 site 私有 DOM media layer。
- 3D runtime：GLB/GLTF/STL/OBJ 等真实 Three.js 预览、缩略图和交互查看，支持 lazy load、AbortSignal、dedupe。
- Storage recovery：quota 失败、派生预览丢失、原始资产缺失、删除恢复失败等统一恢复策略。

### 不复刻

- 插件市场、插件安装、插件刷新、插件 panel layer、插件贡献的右键菜单和选择面板按钮。
- Tauri/Finder 本地路径语义，例如“在 Finder 中打开项目/资源”。site 只提供浏览器可行的打开原始文件、下载原始文件。

## P0：第一屏与核心资产闭环

### Site 产品层

- [x] 首页改成原应用 shell：全屏画布、左侧工具栏、项目切换器、状态栏、导入锁定遮罩。
- [x] 第一屏 UI 对齐桌面端轻量 shell：左侧只保留导入/截图，插件入口不显示；状态栏回到无卡片样式。
- [x] 移除 showcase 的营销 topbar、HUD、关于面板、任务卡入口。
- [x] 浏览器项目菜单支持当前项目、新建、重命名；用 IndexedDB 存储，不暴露本地路径语义。
- [x] 浏览器项目菜单改为贴近桌面端结构：项目行使用打开区域 + 当前项铅笔按钮，并支持菜单内联输入保存/ESC 取消。
- [x] 浏览器项目菜单支持删除当前画布；删除后自动切换到最近画布或创建空白画布。
- [x] 浏览器项目菜单承载 site 专属管理能力：导出 JSON、清理未用资源、清空本地存储。
- [x] 清空存储同时重置媒体资产库和浏览器多画布项目库，操作前二次确认。
- [x] 支持跨所有浏览器画布扫描并清理未引用的本地资源，避免日常删除节点后资产库无限增长；该能力位于项目菜单，不占用原应用第一屏工具 rail。
- [x] 导入按钮和文件拖放支持 image/video/audio/model/html/svg/md/txt/file。
- [x] 选中媒体后出现浮动选择面板：下载、打开原始文件、恢复比例、刷新预览、播放控制。
- [x] 选中媒体浮动面板改为接近桌面端的图标按钮条，并挂在选中节点下方居中；播放进度嵌入同一面板。
- [x] 项目切换器补齐桌面端下拉箭头和 hover/open 状态；空 span 通过 CSS 绘制图标，避免站点侧出现裸文本符号。
- [x] html、markdown、text/file、图片和模型资源支持站内查看；HTML 通过 sandbox iframe 呈现，文本内容安全转义；OBJ/PLY/STL 模型查看器支持拖动旋转和滚轮缩放。
- [x] video/audio 支持站内播放器浮层，视频可显示动态画面，音频使用浏览器原生 controls。
- [x] 选中 video/audio 后可在画布节点位置内联播放；播放层跟随平移、缩放、resize 和节点移动。
- [x] viewer/player header 补齐标题、类型/大小 meta、打开原始文件、下载和关闭；加载中与失败状态在弹窗内展示。

### SDK / 通用能力

- [ ] Browser assets 支持 File/Blob/Text/URL 导入和 derivative 存储。
- [ ] Preview pipeline 支持 image、video poster、audio waveform、text、markdown、html、model placeholder/preview。
  - site 已生成 image preview、video poster、audio waveform、文档卡片；OBJ/PLY/STL 模型可生成几何投影缩略图并在站内查看器里拖动/缩放，GLB/GLTF 等仍为格式卡片。
- [ ] Renderer 内置或可注册预览型节点：image、video、audio、model、text、markdown、html、file。
- [ ] Media runtime 提供 video/audio 的 play/pause/seek/duration/currentTime API。
  - site 内部已抽出 `media-playback.ts`，选择浮层通过统一 playback controller 操作音视频；另有站内播放器用于显示视频画面/音频 controls，并用 DOM media layer 临时支持选中节点内联播放。仍需下沉到 SDK/通用 runtime，并最终支持桌面端那种视频纹理直接替换画布节点。
- [x] Capture API 支持 viewport 截图，site 截图按钮已走 `board.capture()`。

## P1：交互 parity

- [x] 空格拖动画布、中键拖动画布、Windows 右键拖动画布。
- [x] 多选整体 resize 与最小尺寸策略。
- [x] Copy/Cut/Paste 节点，粘贴文件/图片/文本。
- [x] 方向键微移、Cmd/Ctrl+D 复制、Home fit all、Cmd/Ctrl+0 重置缩放。
- [x] 右键上下文菜单：空白处刷新/适配全部；节点上复制、剪切、复制一份、删除、复制节点名称；媒体节点下载、查看内容、打开播放器、恢复比例、刷新预览。
- [x] 右键上下文菜单外观改为接近桌面端的紧凑图标菜单：统一 28px 菜单项、hover 状态、危险操作色彩和图标占位。
- [x] 双击标签重命名。
- [x] 节点重命名从 `window.prompt` 改成接近桌面端的画布浮层编辑体验；右键重命名和非文本节点双击都使用原位输入，Enter/失焦保存、Esc 取消。
- [ ] 选择浮层图标换成与桌面端同源 icon renderer；当前 site 用 CSS 绘制图标，占位和尺寸已接近，但不是完全同源。
- [ ] 右键菜单项顺序继续向桌面端收敛：普通节点只保留桌面端核心项；site 专属媒体查看/播放器操作保留在媒体节点上。

## P2：质量与长期收口

- [ ] 高成本预览模块 lazy load，并支持 AbortSignal 和 dedupe。
- [ ] Object URL lease 生命周期、删除资产、刷新恢复、quota 失败恢复。
  - site 已支持显式清理未引用资产，并在刷新/删除资产时回收对应 Object URL lease；仍需更系统的 quota 失败恢复和 SDK 级生命周期策略。
- [ ] 模型格式逐步从 placeholder 扩到 glb/gltf/stl/obj 等真实预览。
  - site 已支持 OBJ、PLY、ASCII/Binary STL 的顶点投影缩略图和站内交互查看；GLB/GLTF 真实材质/网格预览仍需 SDK/Three.js runtime。
- [ ] SDK 和 site 共用同一套能力，避免 site 私有实现长期分叉。

## 当前推进策略

1. 先把 site 第一屏和导入体验改得像主应用。
2. 先在 site 层临时注册 text/markdown/html/model/file 的预览节点，让用户能验证完整流程。
3. 再把临时实现下沉到 SDK assets/browser 与 renderer 内置能力。
