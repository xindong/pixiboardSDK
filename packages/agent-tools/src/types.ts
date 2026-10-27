import type { AssetImportSource, AssetRecord, AssetRef, BoardChangeSet, BoardCapabilities, ContentFit, JsonValue, RequestOptions } from "@pixi-board/capabilities";
export type CanvasReadInput =
  | { type: "nodes"; ids?: string[]; types?: string[]; limit?: number; cursor?: string; fields?: string[] }
  | { type: "assets"; ids?: string[]; kinds?: string[]; limit?: number; cursor?: string; fields?: string[] }
  | { type: "preview"; id: string; maxWidth?: number; maxHeight?: number; frameNumber?: number; fps?: number };
export type CanvasWriteInput =
  | { type: "create"; nodes: Array<AgentNodeCreate> }
  | { type: "update"; nodes: Array<AgentNodeUpdate> }
  | { type: "delete"; nodeIds: string[] };
export type AgentNodeCreate = {
  id?: string;
  type: string;
  name?: string;
  content?: string;
  path?: string;
  source?: AssetImportSource;
  fileName?: string;
  mimeType?: string;
  relativePath?: string;
  rootPath?: string;
  baseUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  zIndex?: number;
  locked?: boolean;
  visible?: boolean;
  fit?: ContentFit;
  props?: JsonValue;
};
export type AgentNodeUpdate = Omit<AgentNodeCreate, "type"> & { id: string };
export type AgentToolError = { code: string; name: string; message: string; retryable: boolean; requestId?: string; details?: Record<string, unknown> };
export type AgentToolResponse<T> = { ok: true; data: T } | { ok: false; error: AgentToolError };
export type AgentCallOptions = RequestOptions & { origin?: string };
export type AgentTools = { schemas: Record<"canvas.read" | "canvas.write", Record<string, unknown>>; call(name: "canvas.read" | "canvas.write", input: unknown, options?: AgentCallOptions): Promise<AgentToolResponse<unknown>> };
export type CompactNode = { id: string; type: string; name?: string; position?: { x: number; y: number }; size?: { width: number; height: number }; rotation?: number; zIndex?: number; fit?: ContentFit; assetRefs?: Record<string, AssetRef>; props?: JsonValue };
export type CompactAsset = { id: string; kind: string; [key: string]: JsonValue | undefined };
export type CanvasOutput = { type: string; revision: number; requestId?: string; changed?: boolean; nodes?: CompactNode[]; assets?: CompactAsset[]; deletedNodeIds?: string[]; deletedAssetIds?: string[]; changeSet?: BoardChangeSet; page?: { hasMore: boolean; nextCursor?: string }; preview?: { nodeId: string; dataUrl: string; mimeType: string; width?: number; height?: number; revision: number; requestId?: string }; content?: Array<{ type: "image"; dataUrl: string; mimeType: string }> };
export type { BoardCapabilities };
