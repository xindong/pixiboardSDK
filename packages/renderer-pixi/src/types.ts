import type { AssetRef, BoardChangeSet, BoardNode, BoardDocument, JsonValue, Point, WorldBounds } from "@pixi-board/core";
export type PixiDisplayObject = { visible?: boolean; x?: number; y?: number; rotation?: number; zIndex?: number; addChild?(child: PixiDisplayObject): void; removeChild?(child: PixiDisplayObject): void; destroy?(options?: unknown): void; [key: string]: unknown };
export type PixiTicker = { add?(listener: (...args: unknown[]) => void): void; remove?(listener: (...args: unknown[]) => void): void; count?: number };
export type PixiApplication = { stage: PixiDisplayObject; init?(options?: Record<string, unknown>): Promise<void> | void; initOptions?: Record<string, unknown>; destroy?(rendererOptions?: boolean | Record<string, unknown>, stageOptions?: boolean | Record<string, unknown>): void; canvas?: unknown; view?: unknown; ticker?: PixiTicker; renderer?: { extract?: { base64?(options: Record<string, unknown>): Promise<string> | string } }; screen?: { width: number; height: number } };
export type PixiViewFactory = { createContainer(): PixiDisplayObject; createRect?(width: number, height: number, fill: number | string): PixiDisplayObject; createImage?(ref: AssetRef | undefined, node: Readonly<BoardNode>): PixiDisplayObject | Promise<PixiDisplayObject>; createText?(text: string, style?: Record<string, unknown>): PixiDisplayObject };
export type PixiApplicationFactory = () => PixiApplication | Promise<PixiApplication>;
export type PixiRuntimeModule = {
  Application: new () => PixiApplication;
  Container: new (options?: Record<string, unknown>) => PixiDisplayObject;
  Graphics: new () => PixiDisplayObject & { rect?(x: number, y: number, width: number, height: number): PixiDisplayObject; fill?(color: number | string): PixiDisplayObject };
  Sprite: new (texture?: unknown) => PixiDisplayObject;
  Text: new (options?: unknown) => PixiDisplayObject;
  Texture?: { from(source: unknown): unknown };
};
export type TextureLease = { texture?: unknown; release?: () => void };
export type RendererDiagnostics = { creates: number; updates: number; destroys: number; lateUpdates: number; activeViews: number; pendingOperations: number; textureLeases: number; listeners: number; tickers: number };
export type RendererResourceScope = {
  onCleanup(cleanup: () => void): () => void;
  listen(target: { addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: unknown): void; removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: unknown): void }, type: string, listener: EventListenerOrEventListenerObject, options?: unknown): () => void;
  addTicker(listener: (...args: unknown[]) => void): () => void;
};
export type PixiNodeRendererContext = { signal: AbortSignal; assets: { acquireTexture(ref: AssetRef, options?: Record<string, unknown>): Promise<TextureLease> }; resources: RendererResourceScope; invalidate(): void; lod: { level?: number; scale?: number }; diagnostics: RendererDiagnostics; display: PixiViewFactory };
export type PixiNodeView<State = unknown> = { displayObject: PixiDisplayObject; state: State };
export type PixiNodeRenderer<Props extends JsonValue = JsonValue, State = unknown> = { create(node: Readonly<BoardNode<Props>>, context: PixiNodeRendererContext): PixiNodeView<State> | Promise<PixiNodeView<State>>; update(view: PixiNodeView<State>, node: Readonly<BoardNode<Props>>, context: PixiNodeRendererContext): void | Promise<void>; destroy(view: PixiNodeView<State>, context: PixiNodeRendererContext): void; hitTest?(node: Readonly<BoardNode<Props>>, worldPoint: Point): boolean };
export type CullingQuery = (bounds: WorldBounds) => Iterable<string>;
export type SpatialIndexItem = WorldBounds & { id: string };
export type SpatialIndex = {
  rebuild(items: readonly SpatialIndexItem[]): void;
  insert(item: SpatialIndexItem): void;
  update(item: SpatialIndexItem): void;
  remove(id: string): void;
  query(bounds: WorldBounds): Iterable<string>;
  queryPoint?(point: Point): Iterable<string>;
};
export type CaptureTarget =
  | { target: "viewport"; format?: "png"; scale?: number }
  | { target: "node"; nodeId: string; format?: "png"; scale?: number }
  | { target: "bounds"; bounds: WorldBounds; format?: "png"; scale?: number };
export type CaptureRequest = CaptureTarget;
export type CaptureFrame = { target: PixiDisplayObject; frame?: WorldBounds; scale: number; format: "png" };
export type CaptureAdapter = (frame: CaptureFrame, request: CaptureRequest, signal: AbortSignal) => Promise<{ dataUrl: string; mimeType: string; width?: number; height?: number }> | { dataUrl: string; mimeType: string; width?: number; height?: number };
export type RendererCaptureResult = { dataUrl: string; mimeType: string; width?: number; height?: number; revision: number; requestId?: string };
export type RendererSnapshot = Readonly<BoardDocument>;
export type RendererChangeSet = BoardChangeSet;
