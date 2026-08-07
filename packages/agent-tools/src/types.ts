import type { BoardChangeSet, BoardCapabilities, JsonValue, RequestOptions } from "@pixi-board/capabilities";
export type CanvasReadInput =
  | { type: "nodes"; ids?: string[]; types?: string[]; limit?: number; cursor?: string; fields?: string[] }
  | { type: "assets"; ids?: string[]; kinds?: string[]; limit?: number; cursor?: string; fields?: string[] }
  | { type: "preview"; id: string; maxWidth?: number; maxHeight?: number; frameNumber?: number; fps?: number };
export type CanvasWriteInput =
  | { type: "create"; nodes: Array<{ id?: string; type: string; name?: string; content?: string; path?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; zIndex?: number; locked?: boolean; visible?: boolean; props?: JsonValue }> }
  | { type: "update"; nodes: Array<{ id: string; content?: string; path?: string; name?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; zIndex?: number; locked?: boolean; visible?: boolean; props?: JsonValue }> }
  | { type: "delete"; nodeIds: string[] };
export type AgentToolError = { code: string; name: string; message: string; retryable: boolean; requestId?: string; details?: Record<string, unknown> };
export type AgentToolResponse<T> = { ok: true; data: T } | { ok: false; error: AgentToolError };
export type AgentTools = { schemas: Record<"canvas.read" | "canvas.write", Record<string, unknown>>; call(name: "canvas.read" | "canvas.write", input: unknown, options?: RequestOptions & { origin?: string }): Promise<AgentToolResponse<unknown>> };
export type CompactNode = { id: string; type: string; name?: string; [key: string]: unknown };
export type CanvasOutput = { type: string; revision: number; requestId?: string; nodes?: CompactNode[]; assets?: Record<string, unknown>[]; deletedNodeIds?: string[]; changeSet?: BoardChangeSet; page?: { hasMore: boolean; nextCursor?: string }; preview?: Record<string, unknown>; content?: unknown[] };
export type { BoardCapabilities };
