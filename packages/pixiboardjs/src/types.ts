import type {
  BoardChangeEvent,
  BoardCoreOptions,
  BoardDocument,
  BoardDocumentUpdate,
  BoardNode,
  BoardNodeCreateInput,
  BoardNodePatch,
  ChangeOrigin,
  DocumentLoadOptions,
  JsonValue,
  NodeGeometry,
  NodeListFilter,
  NodeResizeRequest,
  Point,
  ResizeHandle,
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

export type {
  BoardCapabilities,
  BoardChangeEvent,
  BoardDocument,
  BoardDocumentUpdate,
  BoardNode,
  BoardNodeCreateInput,
  BoardNodePatch,
  CaptureResult,
  ChangeOrigin,
  DocumentLoadOptions,
  JsonValue,
  NodeGeometry,
  NodeListFilter,
  NodeResizeRequest,
  Point,
  ResizeHandle,
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
  apply(update: BoardDocumentUpdate, changeSet: BoardChangeEvent["changeSet"]): Promise<RendererApplyResult>;
  refreshRegisteredTypes?(): Promise<void>;
  destroy(): Promise<void>;
};

export type RendererApplyResult = "applied" | "rebuild-required";

export type CustomDisplayObject = {
  visible?: boolean;
  x?: number;
  y?: number;
  rotation?: number;
  zIndex?: number;
  addChild?(child: CustomDisplayObject): void;
  removeChild?(child: CustomDisplayObject): void;
  destroy?(options?: unknown): void;
  [key: string]: unknown;
};

export type CustomDisplayFactory = {
  createContainer(): CustomDisplayObject;
  createRect?(width: number, height: number, fill: number | string): CustomDisplayObject;
  createText?(text: string, style?: Record<string, unknown>): CustomDisplayObject;
};

export type CustomTextureLease = { texture?: unknown; release?: () => void };

export type CustomNodeRendererContext = {
  assets: {
    acquireTexture(ref: { assetId: string; variant?: "original" | "preview" | "waveform" }, options?: Record<string, unknown>): Promise<CustomTextureLease>;
  };
  invalidate(): void;
  signal: AbortSignal;
  lod: { level?: number; scale?: number };
  diagnostics: { creates: number; updates: number; destroys: number; lateUpdates: number };
  display: CustomDisplayFactory;
};

export type CustomNodeView<State = unknown> = {
  displayObject: CustomDisplayObject;
  state: State;
};

export type CustomNodeRenderer<Props extends JsonValue = JsonValue, State = unknown> = {
  create(node: Readonly<BoardNode<Props>>, context: CustomNodeRendererContext): CustomNodeView<State> | Promise<CustomNodeView<State>>;
  update(view: CustomNodeView<State>, node: Readonly<BoardNode<Props>>, context: CustomNodeRendererContext): void | Promise<void>;
  destroy(view: CustomNodeView<State>, context: CustomNodeRendererContext): void;
  hitTest?(node: Readonly<BoardNode<Props>>, worldPoint: Point): boolean;
};

export type CustomResizePolicy<Props extends JsonValue> =
  | { mode: "free" }
  | { mode: "aspect-ratio"; ratio?: number }
  | { mode: "fixed" }
  | { mode: "custom"; resize(input: { node: Readonly<BoardNode<Props>>; width: number; height: number }): BoardNodePatch<Props> };

export type CustomNodeDefinition<Props extends JsonValue = JsonValue, State = unknown> = {
  type: string;
  version: number;
  defaults?: Partial<Props>;
  validate(value: unknown): Props;
  getBounds(node: BoardNode<Props>): WorldBounds;
  resize?: CustomResizePolicy<Props>;
  renderer?: CustomNodeRenderer<Props, State>;
};

export type PublicNodeTypeDefinition<Props extends JsonValue = JsonValue, State = unknown> = CustomNodeDefinition<Props, State>;
export type CustomNodeDataDefinition<Props extends JsonValue = JsonValue> = Omit<CustomNodeDefinition<Props>, "renderer">;
export type NodeTypeDefinition<Props extends JsonValue = JsonValue> = CustomNodeDataDefinition<Props>;

export type CustomNodeRendererRegistry = {
  register(type: string, renderer: CustomNodeRenderer, options?: NodeTypeRegistrationOptions): () => void;
  get(type: string): CustomNodeRenderer | undefined;
  has(type: string): boolean;
  list(): string[];
};

export type PublicRendererOptions = {
  registry?: CustomNodeRendererRegistry;
  [key: string]: unknown;
};

export type PixiBoardRendererOptions = PublicRendererOptions;

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
  /** Floor sizes a resize gesture may shrink a node to, in world units. */
  transform?: { minWidth?: number; minHeight?: number };
  ports?: BoardRuntimePorts;
  core?: Omit<BoardCoreOptions, "document">;
  renderer?: PublicRendererOptions;
  rendererFactory?: (options: PublicRendererOptions) => RuntimeRenderer;
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

export type NodeTypeRegistrationOptions = {
  replace?: boolean;
};

/**
 * The selection's axis-aligned world rectangle. A single selected node also
 * reports its `rotation` so a host can draw the outline in the node's own
 * frame; a multi-node selection has no shared rotation and reports `0`.
 */
export type TransformBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  nodeIds: string[];
};

/** Where one control point sits, in world units, plus its CSS cursor. */
export type TransformHandlePlacement = {
  handle: ResizeHandle;
  /** World position of the handle's centre. */
  world: Point;
  cursor: string;
};

export type TransformSession = {
  readonly handle: ResizeHandle;
  /**
   * Applies the total pointer movement since `begin()`, in world units.
   * Deltas are absolute rather than incremental so a gesture stays exact
   * under fractional zoom and dropped frames.
   */
  update(deltaWorld: Point): void;
  /** Ends the gesture. Further `update()` calls are ignored. */
  commit(): void;
  /** Ends the gesture and restores the geometry captured at `begin()`. */
  cancel(): void;
};

export type NodeTypeRegistrationDisposer = () => Promise<void>;

export type NodeQuery = NodeListFilter;

export type PublicBoardEventMap = {
  change: BoardChangeEvent;
  "selection:change": SelectionChangeEvent;
  "viewport:change": ViewportChangeEvent;
  "history:change": HistoryChangeEvent;
  "assets:change": BoardChangeEvent;
  "capability:change": { capability: string; available: boolean };
  "render:complete": RenderCompleteEvent;
};

export type NodeHandleEventMap = {
  change: BoardChangeEvent;
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
  on<EventName extends keyof NodeHandleEventMap>(
    eventName: EventName,
    listener: (event: NodeHandleEventMap[EventName]) => void,
  ): () => void;
}

export interface PixiBoard {
  readonly ready: Promise<void>;
  readonly state: BoardLifecycleState;
  readonly signal: AbortSignal;
  readonly capabilities: BoardCapabilities;
  readonly nodes: {
    create<Props extends JsonValue>(input: BoardNodeCreateInput<Props>): Promise<NodeHandle<Props>>;
    update<Props extends JsonValue>(nodeId: string, patch: BoardNodePatch<Props>): NodeHandle<Props>;
    resize<Props extends JsonValue>(nodeId: string, request: NodeResizeRequest): NodeHandle<Props>;
    remove(nodeId: string): void;
    get<Props extends JsonValue = JsonValue>(nodeId: string): Readonly<BoardNode<Props>> | undefined;
    list(filter?: NodeListFilter): ReadonlyArray<Readonly<BoardNode>>;
  };
  /**
   * Drives resize gestures for the current selection. `transform.begin()`
   * captures the geometry the gesture starts from; each `update()` resolves
   * the accumulated pointer delta through every selected node's ResizePolicy
   * and commits one coalesced transaction, so the whole gesture undoes as a
   * single step.
   */
  readonly transform: {
    handles(): ReadonlyArray<TransformHandlePlacement>;
    bounds(): TransformBounds | undefined;
    begin(handle: ResizeHandle): TransformSession | undefined;
    active(): boolean;
  };
  readonly nodeTypes: {
    register<Props extends JsonValue, State = unknown>(
      definition: PublicNodeTypeDefinition<Props, State>,
      options?: NodeTypeRegistrationOptions,
    ): Promise<NodeTypeRegistrationDisposer>;
    has(type: string): boolean;
    get(type: string): CustomNodeDataDefinition | undefined;
    list(): ReadonlyArray<CustomNodeDataDefinition>;
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
    validate(input: unknown): BoardDocument;
  };
  find(filter?: NodeQuery): ReadonlyArray<Readonly<BoardNode>>;
  findOne(selector: string): Readonly<BoardNode> | undefined;
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
