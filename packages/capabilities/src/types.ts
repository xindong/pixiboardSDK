import type { AssetRecord, BoardChangeSet, BoardCore, BoardDocument, BoardNode, BoardNodeCreateInput, BoardNodePatch, JsonValue, NodeListFilter, ViewportSnapshot } from "@pixi-board/core";
export type { AssetRecord, BoardChangeSet, BoardNode, JsonValue } from "@pixi-board/core";

export type RequestOptions = { signal?: AbortSignal; requestId?: string };
export type WriteOptions = RequestOptions & { origin?: string; label?: string };
export type DocumentLoadOptions = { replaceHistory?: boolean };
export type ReadNodesInput = { filter?: NodeListFilter; limit?: number; cursor?: string };
export type PageInfo = { hasMore: boolean; nextCursor?: string };
export type ReadNodesResult = { nodes: readonly BoardNode[]; page: PageInfo; revision: number; requestId?: string };
export type ReadAssetsResult = { assets: readonly AssetRecord[]; page: PageInfo; revision: number; requestId?: string };
export type CreateNodeInput = BoardNodeCreateInput & { asset?: AssetRecord };
export type UpdateNodeInput = { id: string; patch: BoardNodePatch; asset?: AssetRecord };
export type ChangeSet = BoardChangeSet;
export type WriteResult = { changed: boolean; nodes: readonly BoardNode[]; assets?: readonly AssetRecord[]; deletedNodeIds?: readonly string[]; deletedAssetIds?: readonly string[]; revision: number; changeSet?: BoardChangeSet; requestId?: string };
export type PreviewResult = { nodeId: string; dataUrl: string; mimeType: string; width?: number; height?: number; revision: number; requestId?: string };
export type CaptureResult = { dataUrl: string; mimeType: string; width?: number; height?: number; revision: number; requestId?: string };
export type PreviewService = (input: { nodeId: string; maxWidth?: number; maxHeight?: number; frameNumber?: number; fps?: number }, options: RequestOptions) => Promise< Omit<PreviewResult, "revision" | "requestId"> > | Omit<PreviewResult, "revision" | "requestId">;
export type CaptureService = (input: JsonValue, options: RequestOptions) => Promise<Omit<CaptureResult, "revision" | "requestId">> | Omit<CaptureResult, "revision" | "requestId">;
export type BoardCapabilities = {
  availability: { preview: boolean; capture: boolean };
  document: { snapshot(options?: RequestOptions): Promise<Readonly<BoardDocument>>; load(input: unknown, options?: DocumentLoadOptions & WriteOptions): Promise<{ changed: boolean; revision: number; changeSet: BoardChangeSet; requestId?: string }>; validate(input: unknown, options?: RequestOptions): Promise<BoardDocument> };
  nodes: { read(input?: ReadNodesInput, options?: RequestOptions): Promise<ReadNodesResult>; create(input: { nodes: readonly CreateNodeInput[] }, options?: WriteOptions): Promise<WriteResult>; update(input: { nodes: readonly UpdateNodeInput[] }, options?: WriteOptions): Promise<WriteResult>; delete(input: { nodeIds: readonly string[] }, options?: WriteOptions): Promise<WriteResult> };
  assets: { read(input?: { ids?: readonly string[]; kinds?: readonly string[]; limit?: number; cursor?: string }, options?: RequestOptions): Promise<ReadAssetsResult>; upsert(input: { assets: readonly AssetRecord[] }, options?: WriteOptions): Promise<WriteResult>; remove(input: { assetIds: readonly string[] }, options?: WriteOptions): Promise<WriteResult> };
  selection: { get(options?: RequestOptions): Promise<readonly string[]>; set(nodeIds: readonly string[], options?: WriteOptions): Promise<{ nodeIds: readonly string[]; requestId?: string }> };
  viewport: { get(options?: RequestOptions): Promise<ViewportSnapshot>; set(viewport: ViewportSnapshot, options?: WriteOptions): Promise<{ viewport: ViewportSnapshot; requestId?: string }> };
  history: { canUndo(): boolean; canRedo(): boolean; clear(): void; undo(options?: WriteOptions): BoardChangeSet | undefined; redo(options?: WriteOptions): BoardChangeSet | undefined };
  preview: { get(input: { nodeId: string; maxWidth?: number; maxHeight?: number; frameNumber?: number; fps?: number }, options?: RequestOptions): Promise<PreviewResult> };
  capture: { available: boolean; capture(input: JsonValue, options?: RequestOptions): Promise<CaptureResult> };
};
