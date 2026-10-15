# 通用资产预览契约

SDK 提供资产引用、预览状态和逻辑布局契约。宿主负责文件识别、预览计算（本地或服务端）、任务调度、取消与过期结果处理，以及预览二进制和节点状态的持久化。这些 API 不依赖 DSH 的网络、接口、任务系统或服务端。

## 公开入口

运行时 helper 均从 `pixiboardjs` 主入口导出，类型同时从主入口和 `pixiboardjs/types` 导出：

```ts
import {
  isAssetVariant,
  isDocumentPreviewType,
  isPreviewNodeType,
  createPreviewSpec,
  previewStatusLabel,
} from "pixiboardjs";
import type {
  AssetRef, AssetVariant,
  PreviewStatus, PreviewQuality, PreviewSpec, PreviewState,
  PreviewNode, PreviewSpecOptions,
} from "pixiboardjs/types";
```

实现来源是 `packages/core/src/asset-variant.ts`、`packages/core/src/asset-previews.ts` 和 `packages/core/src/types.ts`。主包通过 `packages/pixiboardjs/src/index.ts` 重导出 core helper，通过 `packages/pixiboardjs/src/types.ts` 重导出类型。

## 资产引用与持久化

`AssetVariant` 是 `'original' | 'preview' | 'waveform' | \`preview-${string}\``。模板字面量类型不校验摘要；运行时必须用 `isAssetVariant(value: unknown)` 校验。它仅接受三个 legacy 名称以及匹配 `^preview-[a-f0-9]{64}$` 的完整字符串，拒绝大写摘要、错误长度、路径片段、尾部换行及非字符串。

`AssetRef` 为 `{ assetId: string; variant?: AssetVariant }`。浏览器 adapter 的 `AssetBinaryVariant` 复用该类型；省略 variant 使用 `original`。文档加载校验和浏览器读写边界复用同一个 helper。非法 variant 会在 adapter 访问存储、调用 `storageKeyFactory` 前抛出 `TypeError`；原生 IndexedDB port 也校验读写的 variant。

宿主可以在同一资产下存储多个不可变的派生预览，例如 `preview-<64位小写SHA-256>`，然后把相应引用放入 `node.assetRefs`。摘要的输入和计算由宿主定义，SDK 不生成摘要。约定摘要应涵盖源文件版本、预览参数以及必要的渲染器版本，避免错误复用缓存。

```ts
// digest 由宿主计算，binary 由宿主的预览计算器生成。
const candidate = `preview-${digest}` as const;
if (!isAssetVariant(candidate)) throw new Error("Invalid preview digest");
const ref: AssetRef = { assetId, variant: candidate };
// browserAdapter 是宿主持有的浏览器持久化 adapter。
await browserAdapter.putDerivative(assetId, candidate, binary);
// 宿主随后更新节点的预览引用并持久化文档。
```

自定义 renderer 的 `context.assets.acquireTexture(ref, options?)` 接受同一个 `AssetRef`，可以直接加载摘要预览。SDK 不自动选择预览引用的名称，也不自动生成或切换预览。

## 状态与布局

`PreviewState` 是放在节点 props 中的可选字段契约：

| 字段 | 类型 / 用途 |
| --- | --- |
| `previewStatus` | `PreviewStatus`：`pending`、`queued`、`running`、`ready`、`error`、`failed`、`unsupported` |
| `previewSpec` | `PreviewSpec`：`width`、`height`、`page`、`mode`、`quality` |
| `previewQuality` | `PreviewQuality`：`thumbnail` 或 `detail`，宿主记录当前产物质量 |
| `previewRequestId`、`previewJobId` | 可选 `string \| null`，宿主关联请求与任务 |
| `previewError` | 可选 `string \| null`，保存完整错误信息供详情界面使用 |

`isDocumentPreviewType(type: string)` 识别 `html`、`markdown`、`text-file`、`file`。`isPreviewNodeType(type: string)` 额外识别 `model`。这些函数只分类，不注册节点类型，也不判断文件能否成功渲染。

`createPreviewSpec(node: PreviewNode, options?: PreviewSpecOptions): PreviewSpec` 是纯函数。最小输入为 `{ width, height, props? }`；可选 `type: 'model'` 选择模型默认高度。

- 默认逻辑视口为 1024 × 704，模型为 1024 × 768，`page: 1`、`mode: 'viewport'`、`quality: 'thumbnail'`。
- 已保存的 `props.previewSpec` 为计算基准，普通调用不随卡片大小、缩放或屏幕像素密度重新布局。
- `options.reason` 为 `reset` 或 `refresh` 时，保留已保存的逻辑宽度（缺省 1024），仅采用当前卡片的高宽比计算高度，设为 `mode: 'fixed-viewport'`，默认质量为 `detail`。无有效卡片比例时采用对应类型的默认比例。
- `options.quality`、`width`、`height`、`page` 可显式覆盖；宽高覆盖在 reset/refresh 的比例计算之后应用。
- 宽高为正整数，单边不超过 4096，总像素数不超过 8,000,000；按比例缩小，最终舍入也受总像素上限约束。
- 缺失、NaN、Infinity、非数值或非正尺寸回退到默认值；可解析的数值字符串兼容旧的持久化数据。页码取正整数，无效值回退到 1，上限为 `Number.MAX_SAFE_INTEGER`。
- 不修改输入、节点几何、相机或资产引用。宿主显式写回返回值，决定何时生成、保存或升级预览。

```ts
const spec = createPreviewSpec(node, { reason: "refresh", quality: "detail" });
const state: PreviewState = {
  previewStatus: "pending",
  previewSpec: spec,
  previewError: null,
};
// 合并 state 到节点 props 后，由宿主提交计算请求。
// 任务结束时，宿主检查 requestId，写入二进制、引用、quality 与 ready/error。
```

## 中文短标签与 ZIP

`previewStatusLabel(node, typeLabel): string` 返回完整的短标签：

| 状态 | 示例 |
| --- | --- |
| `pending` / `queued` / `running` | `PDF:预览生成中` |
| `error` / `failed` / `unsupported` | `PDF:暂无预览` |
| `ready` / 未设置 / 未识别状态 | `PDF` |

ZIP 通过 `props.fileExtension` 或文件名后缀识别，后缀不区分大小写。非模型 ZIP 使用 `ZIP` 类型标签；模型 ZIP 通常保留模型标签，若 `previewError` 包含 `ZIP_NO_MODEL` 则使用 `ZIP`。文件名优先采用 `props.name`，否则采用节点 `name`。

完整失败原因保存在 `previewError`，不拼接到短标签。宿主自行决定是否在详情、提示或重试界面展示原因。
