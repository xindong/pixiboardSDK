import type { AssetRecord, AssetRef, BoardChangeSet, BoardCore, BoardDocument, BoardNode, BoardNodeCreateInput, BoardNodePatch, ContentFit, JsonValue, NodeListFilter, ViewportSnapshot } from "@pixi-board/core";
export type { AssetRecord, BoardChangeSet, BoardNode, JsonValue } from "@pixi-board/core";

export type RequestOptions = { signal?: AbortSignal; requestId?: string };
export type WriteOptions = RequestOptions & {
  origin?: string;
  label?: string;
  /** Remote/background writes still emit changes but can stay out of undo history. */
  recordHistory?: boolean;
};
export type DocumentLoadOptions = { replaceHistory?: boolean };
export type ReadNodesInput = { filter?: NodeListFilter; limit?: number; cursor?: string };
export type PageInfo = { hasMore: boolean; nextCursor?: string };
export type ReadNodesResult = { nodes: readonly BoardNode[]; page: PageInfo; revision: number; requestId?: string };
export type ReadAssetsResult = { assets: readonly AssetRecord[]; page: PageInfo; revision: number; requestId?: string };
/** Host-neutral import source. The host adapter owns filesystem/network access. */
export type AssetImportSource =
  | {
      type: "content";
      content: string;
      fileName?: string;
      mimeType?: string;
      relativePath?: string;
      rootPath?: string;
      baseUrl?: string;
    }
  | {
      type: "file";
      path: string;
      fileName?: string;
      mimeType?: string;
      relativePath?: string;
      rootPath?: string;
      baseUrl?: string;
    }
  | {
      type: "url";
      url: string;
      fileName?: string;
      mimeType?: string;
      relativePath?: string;
      baseUrl?: string;
    };

export type AssetImportRequest = {
  source: AssetImportSource;
  /** Desired canvas node type; the provider uses it to select derivatives. */
  nodeType: string;
  name?: string;
  /** Caller-provided overrides for hosts that already know these facts. */
  mimeType?: string;
  width?: number;
  height?: number;
};

/**
 * The provider probes original bytes, persists originals/derivatives, and
 * returns a stable asset plus renderable refs. It must not return an original
 * video or document as a Pixi texture ref.
 */
export type ImportedAsset = {
  asset: AssetRecord;
  assetRefs?: Record<string, AssetRef>;
  width?: number;
  height?: number;
  duration?: number;
  /** Additional media props merged before caller props. */
  props?: Record<string, JsonValue>;
  previewStatus?: "pending" | "queued" | "running" | "ready" | "error" | "failed" | "unsupported";
  fit?: ContentFit;
};

export type AssetImportService = (
  input: AssetImportRequest,
  options: RequestOptions,
) => Promise<ImportedAsset> | ImportedAsset;

type DirectCreateNodeInput = BoardNodeCreateInput & {
  /** Persisted with the node in one transaction; explicit assetRefs are preserved. */
  asset?: AssetRecord;
  source?: undefined;
};
type SourceCreateNodeInput = Omit<BoardNodeCreateInput, "x" | "y" | "width" | "height"> & {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  asset?: undefined;
  /** Unified browser/Agent/path import path. Geometry is inferred unless supplied. */
  source: AssetImportSource;
};
export type CreateNodeInput = DirectCreateNodeInput | SourceCreateNodeInput;
export type UpdateNodeInput = {
  id: string;
  patch: BoardNodePatch;
  asset?: AssetRecord;
  source?: AssetImportSource;
};
export type ChangeSet = BoardChangeSet;
export type WriteResult = { changed: boolean; nodes: readonly BoardNode[]; assets?: readonly AssetRecord[]; deletedNodeIds?: readonly string[]; deletedAssetIds?: readonly string[]; revision: number; changeSet?: BoardChangeSet; requestId?: string };
export type PreviewResult = { nodeId: string; dataUrl: string; mimeType: string; width?: number; height?: number; revision: number; requestId?: string };
export type CaptureResult = { dataUrl: string; mimeType: string; width?: number; height?: number; revision: number; requestId?: string };
export type PreviewService = (input: { nodeId: string; maxWidth?: number; maxHeight?: number; frameNumber?: number; fps?: number }, options: RequestOptions) => Promise< Omit<PreviewResult, "revision" | "requestId"> > | Omit<PreviewResult, "revision" | "requestId">;
export type CaptureService = (input: JsonValue, options: RequestOptions) => Promise<Omit<CaptureResult, "revision" | "requestId">> | Omit<CaptureResult, "revision" | "requestId">;
export type BoardCapabilities = {
  availability: { preview: boolean; capture: boolean; import: boolean };
  document: { snapshot(options?: RequestOptions): Promise<Readonly<BoardDocument>>; load(input: unknown, options?: DocumentLoadOptions & WriteOptions): Promise<{ changed: boolean; revision: number; changeSet: BoardChangeSet; requestId?: string }>; validate(input: unknown, options?: RequestOptions): Promise<BoardDocument> };
  nodes: { read(input?: ReadNodesInput, options?: RequestOptions): Promise<ReadNodesResult>; create(input: { nodes: readonly CreateNodeInput[] }, options?: WriteOptions): Promise<WriteResult>; update(input: { nodes: readonly UpdateNodeInput[] }, options?: WriteOptions): Promise<WriteResult>; delete(input: { nodeIds: readonly string[] }, options?: WriteOptions): Promise<WriteResult> };
  assets: { read(input?: { ids?: readonly string[]; kinds?: readonly string[]; limit?: number; cursor?: string }, options?: RequestOptions): Promise<ReadAssetsResult>; upsert(input: { assets: readonly AssetRecord[] }, options?: WriteOptions): Promise<WriteResult>; remove(input: { assetIds: readonly string[] }, options?: WriteOptions): Promise<WriteResult> };
  selection: { get(options?: RequestOptions): Promise<readonly string[]>; set(nodeIds: readonly string[], options?: WriteOptions): Promise<{ nodeIds: readonly string[]; requestId?: string }> };
  viewport: { get(options?: RequestOptions): Promise<ViewportSnapshot>; set(viewport: ViewportSnapshot, options?: WriteOptions): Promise<{ viewport: ViewportSnapshot; requestId?: string }> };
  history: { canUndo(): boolean; canRedo(): boolean; clear(): void; undo(options?: WriteOptions): BoardChangeSet | undefined; redo(options?: WriteOptions): BoardChangeSet | undefined };
  preview: { get(input: { nodeId: string; maxWidth?: number; maxHeight?: number; frameNumber?: number; fps?: number }, options?: RequestOptions): Promise<PreviewResult> };
  capture: { available: boolean; capture(input: JsonValue, options?: RequestOptions): Promise<CaptureResult> };
};
