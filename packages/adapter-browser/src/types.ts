import type { AssetRecord, BoardDocument, BoardNode, JsonValue } from "@pixi-board/core";

export type BrowserDocumentMetadata = Record<string, JsonValue>;

export type BrowserDocumentRecord = {
  snapshot: BoardDocument;
  metadata: BrowserDocumentMetadata;
  savedAt: number;
};

export type SaveBrowserDocumentInput = {
  snapshot: BoardDocument;
  metadata?: BrowserDocumentMetadata;
  /**
   * Compare-and-swap guard for shared browser storage. `null` requires that no
   * document exists; `undefined` preserves the legacy unconditional write.
   */
  expectedRevision?: number | null;
};

export type SaveBrowserDocumentOptions = {
  expectedRevision?: number | null;
};

export type AssetStorageLocation =
  | { kind: "indexeddb" }
  | { kind: "opfs"; key: string };

export type AssetBinaryVariant = "original" | "preview" | "waveform";

export type StoredAssetBinary = {
  storage: AssetStorageLocation;
  size: number;
  mimeType: string;
  updatedAt: number;
};

export type StoredAssetEntry = {
  id: string;
  record: AssetRecord;
  binaries: Record<string, StoredAssetBinary>;
  createdAt: number;
  updatedAt: number;
  quarantinedAt?: number;
};

export type BrowserAsset = {
  entry: StoredAssetEntry;
  variant: AssetBinaryVariant;
  binary: StoredAssetBinary;
  blob: Blob;
};

export type PutAssetOptions = {
  signal?: AbortSignal;
  preferOpfs?: boolean;
  variant?: AssetBinaryVariant;
};

export type GetAssetOptions = AdapterOperationOptions & {
  variant?: AssetBinaryVariant;
};

export type AdapterOperationOptions = {
  signal?: AbortSignal;
};

export interface PortLifecycle {
  close?(): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface IndexedDbPort extends PortLifecycle {
  loadDocument(signal: AbortSignal): Promise<BrowserDocumentRecord | undefined>;
  saveDocument(
    record: BrowserDocumentRecord,
    signal: AbortSignal,
    options?: SaveBrowserDocumentOptions,
  ): Promise<void>;
  getAssetEntry(id: string, signal: AbortSignal): Promise<StoredAssetEntry | undefined>;
  listAssetEntries(signal: AbortSignal): Promise<StoredAssetEntry[]>;
  getAssetBlob(id: string, variant: AssetBinaryVariant, signal: AbortSignal): Promise<Blob | undefined>;
  /** Atomically commits metadata and the optional IndexedDB Blob fallback. */
  putAssetEntry(
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
  ): Promise<void>;
  /** Atomically commits the document plus asset metadata and optional Blob fallback. */
  commitAssetAndDocument(
    document: BrowserDocumentRecord,
    entry: StoredAssetEntry,
    binaryWrite: { variant: AssetBinaryVariant; blob: Blob } | undefined,
    signal: AbortSignal,
    options?: SaveBrowserDocumentOptions,
  ): Promise<void>;
  /** Atomically removes asset metadata and any IndexedDB Blob fallback. */
  deleteAssetEntry(entry: StoredAssetEntry, signal: AbortSignal): Promise<void>;
}

export interface OpfsPort extends PortLifecycle {
  isAvailable(signal: AbortSignal): Promise<boolean>;
  get(key: string, signal: AbortSignal): Promise<Blob | undefined>;
  put(key: string, blob: Blob, signal: AbortSignal): Promise<void>;
  delete(key: string, signal: AbortSignal): Promise<void>;
}

export interface ObjectUrlPort extends PortLifecycle {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export type BrowserDownloadRequest = {
  url: string;
  fileName: string;
  mimeType: string;
};

export interface DownloadPort extends PortLifecycle {
  download(request: BrowserDownloadRequest): void | Promise<void>;
}

export interface ObjectUrlLease {
  readonly assetId: string;
  readonly variant: AssetBinaryVariant;
  readonly url: string;
  readonly revoked: boolean;
  revoke(): void;
}

export type AssetGcRoots = {
  assetIds?: Iterable<string>;
  historyAssetIds?: Iterable<string>;
  activeJobAssetIds?: Iterable<string>;
  explicitLeaseAssetIds?: Iterable<string>;
};

export type AssetGcOptions = AssetGcRoots & {
  quarantineMs?: number;
  now?: number;
  signal?: AbortSignal;
};

export type AssetGcResult = {
  roots: string[];
  retained: string[];
  quarantined: string[];
  restored: string[];
  deleted: string[];
};

export type BrowserCleanupOperation =
  | "metadata-compensation"
  | "import-compensation"
  | "replace-old-opfs"
  | "delete-opfs"
  | "gc-opfs"
  | "destroy-port"
  | "cleanup-observer";

export type BrowserCleanupError = {
  operation: BrowserCleanupOperation;
  error: unknown;
  timestamp: number;
  assetId?: string;
  variant?: AssetBinaryVariant;
  key?: string;
  port?: "indexeddb" | "opfs" | "object-urls" | "download";
};

export type BrowserImportSourceType = "file" | "blob" | "text" | "url";

export type BrowserPrepareImportOptions = AdapterOperationOptions & {
  assetId?: string;
  kind?: string;
  name?: string;
  mimeType?: string;
  assetMetadata?: Record<string, JsonValue>;
  request?: RequestInit;
};

export type BrowserPreparedImport = {
  sourceType: BrowserImportSourceType;
  asset: AssetRecord;
  blob: Blob;
  fileName: string;
};

export type BrowserCommitImportOptions = AdapterOperationOptions & {
  document: BoardDocument;
  documentMetadata?: BrowserDocumentMetadata;
  expectedRevision?: number | null;
  nodeId?: string;
  nodeType?: string;
  nodeProps?: JsonValue;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  preferOpfs?: boolean;
};

export type BrowserImportOptions = BrowserPrepareImportOptions & BrowserCommitImportOptions;

export type BrowserImportResult = {
  sourceType: BrowserImportSourceType;
  document: BoardDocument;
  asset: AssetRecord;
  node: BoardNode;
  entry: StoredAssetEntry;
};

export type BrowserAssetExport = {
  assetId: string;
  variant: AssetBinaryVariant;
  blob: Blob;
  fileName: string;
  mimeType: string;
};

export type BrowserExportOptions = GetAssetOptions & {
  fileName?: string;
};

export type BrowserAdapterCapabilities = {
  persistence: true;
  indexedDb: true;
  opfs: boolean;
  blobFallback: true;
  import: readonly BrowserImportSourceType[];
  objectUrl: true;
  download: boolean;
  desktopFileSystem: false;
};

export type BrowserPersistenceAdapterOptions = {
  indexedDb: IndexedDbPort;
  opfs?: OpfsPort;
  objectUrls?: ObjectUrlPort;
  download?: DownloadPort;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  idFactory?: () => string;
  storageKeyFactory?: (assetId: string, variant: AssetBinaryVariant) => string;
  opfsThresholdBytes?: number;
  defaultGcQuarantineMs?: number;
  onCleanupError?: (record: BrowserCleanupError) => void;
};
