# ADR 0014：预览由可注册的渲染器生成，core 不含格式知识

- Status: Accepted
- Date: 2026-11-12

## Context

文档与模型预览最初写在站点里：一张扩展名白名单加一串 `if` 分支，core 里还有 `isDocumentPreviewType`、`isPreviewNodeType`、ZIP 特判和写死的模型默认高度。新增一种格式必须同时改 core、站点分类表和渲染分支；SDK 自带格式与使用者新增的格式也不平等。

## Decision

- core 只定义 `PreviewRenderer` 接口和 `PreviewRendererRegistry`，不内置任何渲染器，不出现格式字面量。
- 渲染器通过 `supports(source)` 声明自己处理什么（可异步、可读文件头），按优先级与注册顺序解析；"能否预览"由注册表命中情况回答，而不是查白名单。
- SDK 自带格式与使用者新增格式使用同一个 `register()`。内置渲染器放在 `@pixi-board/preview-browser`，只依赖公开接口。
- `scripts/check-no-format-knowledge.mjs` 在 CI 中扫描 core 的预览相关文件，禁止格式字面量。
- 移除 `isDocumentPreviewType`、`isPreviewNodeType` 和 `previewStatusLabel` 的 ZIP 分支；`createPreviewSpec` 的模型高度改为宿主传入 `defaultHeight`。
- 3D 模型预览使用 `mivo-model-viewer`；ZIP 按普通文件处理。
- 渲染器是可信代码，由宿主显式注册，不提供插件自动发现。

## Consequences

收益：新增格式只需写一个渲染器并注册；core 保持无格式知识；内置与第三方渲染器地位一致。

代价与未完成项：

- 渲染器只解决"文件 → 预览图"，不创建节点类型。新增卡片种类仍要改宿主的节点类型、分类表和上传 `accept`。
- 导入、写回与过期请求处理的管线仍在宿主（站点），尚未进入 SDK。
- `supports()` 目前仍可读取宿主的 `kind`；后续应改为只看文件本身，并让渲染器自带扩展名与标签声明。
- 两个破坏性变更（移除两个导出）在 alpha 阶段直接发布。
