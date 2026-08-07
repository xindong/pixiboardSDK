# 平台、资产与持久化

## 目标

Web 和 Tauri 共用 core、Pixi renderer、capabilities 与公共 API；差异通过窄 port/adapter 注入。能力缺失使用 feature negotiation，而不是让一个宽泛 Repository 的大部分方法正常抛错。

## 拆分当前 BoardRepository

```ts
interface DocumentPersistence {
  load(): Promise<SerializedBoardDocument | null>;
  save(document: SerializedBoardDocument): Promise<void>;
}

interface AssetMetadataStore {
  get(id: string): Promise<AssetRecord | undefined>;
  put(assets: AssetRecord[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

interface AssetImporter {
  import(input: AssetImportSource, options?: AssetImportOptions): Promise<AssetRecord>;
}

interface AssetResolver {
  resolve(assetId: string, variant: AssetVariant): Promise<ResolvedAsset>;
}

interface DerivativeStore {
  put(input: SaveDerivativeInput): Promise<AssetRecord>;
}

interface AssetExporter {
  export(assetId: string): Promise<ExportResult>;
}
```

桌面专属能力单独定义：

```ts
interface DesktopShellCapability {
  revealProject(): Promise<void>;
  revealAsset(assetId: string): Promise<void>;
  pickFiles(options?: PickFilesOptions): Promise<HostFile[]>;
}
```

## Capability Set

Runtime 构造时声明可用能力：

```ts
type RuntimeCapabilities = {
  persistence?: DocumentPersistence;
  assetMetadata?: AssetMetadataStore;
  assetImporter?: AssetImporter;
  assetResolver?: AssetResolver;
  derivatives?: DerivativeStore;
  exporter?: AssetExporter;
  desktopShell?: DesktopShellCapability;
};
```

没有 importer 的画布仍可加载远程资产文档；没有 persistence 的画布仍可作为临时实例。公共 API 可用性由 `board.capabilities.has("assets.import")` 查询。

## Browser Adapter

### 文档与二进制数据

- IndexedDB 保存 document、asset metadata、索引、迁移和小型配置。
- OPFS 保存原始媒体与 derivatives；不支持 OPFS 时回退到 IndexedDB Blob store。
- 导入默认复制到 SDK 管理存储；外部大文件引用属于 experimental capability。
- document、asset metadata 和 derivative 更新需要可恢复 transaction 或明确补偿策略。

### 资产输入

```ts
type AssetImportSource =
  | { kind: "file"; file: File }
  | { kind: "blob"; blob: Blob; name?: string }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string; mimeType: string };
```

核心模型不使用绝对本地路径表达浏览器资产。

### URL 生命周期

- Object URL 由 adapter/lease 创建和 revoke。
- Node renderer 不永久缓存 URL 字符串。
- 删除 asset、销毁 runtime 或替换 Blob 后必须撤销旧 URL。
- 远程 URL 需要处理 CORS、过期和离线失败。

### Browser 导出

默认返回 Blob 或触发可选 download helper：

```ts
type ExportResult = {
  blob: Blob;
  suggestedName: string;
};
```

不返回“保存后的绝对路径”。

## Tauri Adapter

复用现有 Rust 能力：

- project snapshot 和 schema 文件。
- 批量/流式文件导入。
- asset catalog 和 derivatives。
- asset protocol URL。
- download/reveal/dialog。
- plugin HostFile、process 和 MCP bridge。

但 Tauri adapter 应分别实现窄接口，不能将当前 `TauriBoardRepository` 原样作为 SDK 公共契约。

项目切换仍属于 desktop product：

```text
ProjectSessionController
        │ create adapters for selected project
        ▼
createPixiBoard({ persistence, assets, ... })
```

## Asset 与 Node 解耦

- 一个 asset 可以被多个 node 引用。
- 自定义节点可以不引用 asset。
- 删除 node 不一定立即删除 asset。
- asset GC 由显式 policy 决定，必须考虑 history、generating task 和 plugin reference。
- `node.type` 不随 asset kind 自动变化。

建议引用：

```ts
type AssetRef = {
  assetId: string;
  variant?: "original" | "preview" | "waveform";
};
```

节点使用命名引用：`assetRefs.primary`、`assetRefs.poster` 等；旧顶层 `assetId` 迁移为 `assetRefs.primary`。

Asset GC 使用 mark-and-sweep，根集合为当前 document、history、活跃 jobs 和显式 leases。未引用资产默认 quarantine 24 小时后才允许 prune。

## Preview Pipeline

现有 `apps/desktop/src/assets/` 拆为：

```text
assets-core
  queue, jobs, metadata, derivative policy

assets-browser
  canvas, image/video, html-to-image, marked, Three.js

adapter-tauri
  source files and derivative persistence
```

高成本模块必须 lazy load。Preview job 必须支持 priority、deduplication、AbortSignal 和 resource budget。

## 持久化语义

Core commit 与外部存储之间采用内存先提交、异步持久化模型：

```text
transaction commit
  -> revision/change event
  -> renderer updates
  -> persistence scheduled
```

持久化失败：

- 不自动回滚已经展示给用户的文档。
- runtime 进入 dirty/error 状态。
- 发出 `persistence:error`。
- 支持重试和显式 `flush()`。
- 应用在切换项目/关闭窗口前等待 flush 或提示用户。

## Schema 与 Migration

SDK 的 canonical document schema 和 migration 位于 TypeScript core。Rust/Tauri 负责安全文件 IO，不应成为唯一理解 schema 的实现。

加载顺序：

```text
parse JSON
 -> document schema migration
 -> basic validation
 -> node type migrations
 -> asset reference validation
 -> load into core
```

未知 node type 保留原始数据，不因当前 runtime 未注册而删除。

## 验收

### Browser

- 导入 image/video/text/markdown。
- 刷新页面后恢复节点和资产。
- 删除、重新导入和 export。
- Object URL 不泄漏。
- quota/transaction failure 有可恢复错误。

### Tauri

- 旧 schema v4 项目可迁移和保存。
- 原始文件、preview、waveform 和 metadata 不丢失。
- project switch 后前一个 runtime 完全销毁。
- Finder/dialog/process/MCP 不进入 Web bundle。
