import type { BoardChangeSet, BoardDocument, BoardDocumentUpdate, Point, WorldBounds } from "@pixi-board/core";
import type { CaptureRequest, RendererCaptureResult } from "../../../renderer-pixi/src/types";
import type { ConnectionCurve, ConnectionStyle } from "@pixi-board/core";
export type { ConnectionCurve, ConnectionStyle } from "@pixi-board/core";
export { createPixiApplicationFactory, loadPixiRuntime } from "../../../renderer-pixi/src/pixi-adapter";

/** Public, host-agnostic renderer configuration. Internal renderer ports remain bundled implementation details. */
export type PixiBoardRendererOptions = Readonly<Record<string, unknown>>;

/** Public drawing/query surface; the Pixi container remains an implementation detail. */
export declare class ConnectionRenderLayer {
  setEnabled(enabled: boolean): void;
  setSelected(id?: string): void;
  setStyle(style: Partial<ConnectionStyle>): void;
  setVisibleBounds(bounds?: WorldBounds): void;
  upsert(curve: ConnectionCurve): void;
  remove(id: string): void;
  hitTest(point: Point, tolerance: number): string | undefined;
  destroy(): void;
}

/** Declaration-only shape used while bundling the public pixiboardjs API. */
export declare class PixiBoardRenderer {
  constructor(options: PixiBoardRendererOptions);
  init(): Promise<void>;
  rebuild(snapshot: Readonly<BoardDocument>): Promise<void>;
  apply(update: BoardDocumentUpdate, changeSet: BoardChangeSet): Promise<void>;
  createConnectionLayer(): Promise<ConnectionRenderLayer>;
  capture(input: CaptureRequest, options?: { signal?: AbortSignal; requestId?: string }): Promise<RendererCaptureResult>;
  destroy(): Promise<void>;
}

export { GridSpatialIndex } from "../../../renderer-pixi/src/spatial";
export declare const defaultConnectionStyle: ConnectionStyle;
export declare function normalizeConnectionStyle(style: ConnectionStyle): ConnectionStyle;
