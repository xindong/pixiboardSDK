import type {
  BoardChangeEvent,
  BoardCoreOptions,
  BoardDocument,
  BoardNode,
  BoardNodeCreateInput,
  BoardNodePatch,
  ChangeOrigin,
  DocumentLoadOptions,
  JsonValue,
  NodeListFilter,
  Point,
  TransactionOptions,
  ViewportSnapshot,
  WorldBounds,
} from "@pixi-board/core";
import type {
  BoardCapabilities,
  CaptureResult,
  CaptureService,
  PreviewService,
  RequestOptions,
} from "@pixi-board/capabilities";
import type { PixiBoardRendererOptions } from "@pixi-board/renderer-pixi";

export type {
  BoardCapabilities,
  BoardChangeEvent,
  BoardDocument,
  BoardNode,
  BoardNodeCreateInput,
  BoardNodePatch,
  CaptureResult,
  ChangeOrigin,
  DocumentLoadOptions,
  JsonValue,
  NodeListFilter,
  Point,
  TransactionOptions,
  ViewportSnapshot,
  WorldBounds,
};

export type BoardLifecycleState =
  | "created"
  | "mounting"
  | "ready"
  | "destroying"
  | "destroyed";

export type DocumentPersistence = {
  load?(options?: { signal?: AbortSignal }): Promise<BoardDocument | null>;
  save?(document: BoardDocument, options?: { signal?: AbortSignal }): Promise<void>;
  destroy?(): void | Promise<void>;
};

export type RuntimeRenderer = {
  init(): Promise<void>;
  rebuild(snapshot: Readonly<BoardDocument>): Promise<void>;
  apply(snapshot: Readonly<BoardDocument>, changeSet?: BoardChangeEvent["changeSet"]): Promise<void>;
  destroy(): Promise<void>;
};

export type BrowserEventPort = {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
};

export type ResizeObserverPort = {
  observe(target: Element): void;
  disconnect(): void;
};

export type TickerPort = {
  add(listener: () => void): void;
  remove(listener: () => void): void;
};

export type BoardRuntimePorts = {
  events?: BrowserEventPort;
  createResizeObserver?: (callback: ResizeObserverCallback) => ResizeObserverPort;
  ticker?: TickerPort;
  onKeyboardEvent?: (event: Event) => void;
  onClipboardEvent?: (event: Event) => void;
};

export type PixiBoardOptions = {
  container?: Element | null;
  document?: unknown;
  headless?: boolean;
  persistence?: DocumentPersistence;
  interactions?: { pointer?: boolean; keyboard?: boolean; clipboard?: boolean };
  ports?: BoardRuntimePorts;
  core?: Omit<BoardCoreOptions, "document">;
  renderer?: PixiBoardRendererOptions;
  rendererFactory?: (options: PixiBoardRendererOptions) => RuntimeRenderer;
  preview?: PreviewService;
  capture?: CaptureService;
};

export type CaptureInput =
  | { target: "viewport"; format?: "png" | "jpeg"; scale?: number }
  | { target: "node"; nodeId: string; format?: "png" | "jpeg"; scale?: number }
  | { target: "bounds"; bounds: WorldBounds; format?: "png" | "jpeg"; scale?: number };

export type SelectionChangeEvent = { nodeIds: string[]; previousNodeIds: string[] };
export type ViewportChangeEvent = {
  viewport: ViewportSnapshot;
  previousViewport: ViewportSnapshot;
};
export type HistoryChangeEvent = { canUndo: boolean; canRedo: boolean };
export type RenderCompleteEvent = { revision: number; frameId: number };

export type PublicBoardEventMap = {
  change: BoardChangeEvent;
  "selection:change": SelectionChangeEvent;
  "viewport:change": ViewportChangeEvent;
  "history:change": HistoryChangeEvent;
  "assets:change": BoardChangeEvent;
  "capability:change": { capability: string; available: boolean };
  "render:complete": RenderCompleteEvent;
};

export interface NodeHandle<Props extends JsonValue = JsonValue> {
  readonly id: string;
  getAttrs(): Readonly<BoardNode<Props>>;
  setAttrs(patch: BoardNodePatch<Props>): this;
  x(): number;
  x(value: number): this;
  y(): number;
  y(value: number): this;
  width(): number;
  width(value: number): this;
  height(): number;
  height(value: number): this;
  rotation(): number;
  rotation(value: number): this;
  visible(): boolean;
  visible(value: boolean): this;
  remove(): void;
  on(eventName: string, listener: (event: unknown) => void): () => void;
}

export interface PixiBoard {
  readonly ready: Promise<void>;
  readonly state: BoardLifecycleState;
  readonly signal: AbortSignal;
  readonly capabilities: BoardCapabilities;
  readonly nodes: {
    create<Props extends JsonValue>(input: BoardNodeCreateInput<Props>): Promise<NodeHandle<Props>>;
    update<Props extends JsonValue>(nodeId: string, patch: BoardNodePatch<Props>): NodeHandle<Props>;
    remove(nodeId: string): void;
    get<Props extends JsonValue = JsonValue>(nodeId: string): Readonly<BoardNode<Props>> | undefined;
    list(filter?: NodeListFilter): ReadonlyArray<Readonly<BoardNode>>;
  };
  readonly selection: {
    get(): string[];
    set(nodeIds: Iterable<string>): void;
    toggle(nodeId: string): void;
    clear(): void;
    onChange(listener: (event: SelectionChangeEvent) => void): () => void;
  };
  readonly viewport: {
    get(): ViewportSnapshot;
    set(value: ViewportSnapshot): void;
    panBy(deltaX: number, deltaY: number): void;
    zoomAt(screenPoint: Point, factor: number): void;
    fitNodes(nodeIds: string[]): void;
    fitBounds(bounds: WorldBounds): void;
    toWorld(point: Point): Point;
    toScreen(point: Point): Point;
  };
  readonly history: {
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): BoardChangeEvent["changeSet"] | undefined;
    redo(): BoardChangeEvent["changeSet"] | undefined;
    clear(): void;
  };
  readonly document: {
    snapshot(): Readonly<BoardDocument>;
    toJSON(): BoardDocument;
    load(input: unknown, options?: DocumentLoadOptions): Promise<void>;
    validate(input: unknown, options?: Pick<DocumentLoadOptions, "migrate">): BoardDocument;
  };
  node<Props extends JsonValue = JsonValue>(nodeId: string): NodeHandle<Props>;
  transaction<Result>(label: string, operation: () => Result, options?: TransactionOptions): Result;
  on<EventName extends keyof PublicBoardEventMap>(
    eventName: EventName,
    listener: (event: PublicBoardEventMap[EventName]) => void,
  ): () => void;
  focus(): void;
  capture(input: CaptureInput, options?: RequestOptions): Promise<CaptureResult>;
  destroy(): Promise<void>;
}

export type NodePatch<Props extends JsonValue = JsonValue> = BoardNodePatch<Props>;
export type NodeInput<Props extends JsonValue = JsonValue> = BoardNodeCreateInput<Props>;
export type TransactionOrigin = ChangeOrigin;
