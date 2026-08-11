export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type WorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ViewportSnapshot = {
  scale: number;
  offset: Point;
};

export type AssetRef = {
  assetId: string;
  variant?: "original" | "preview" | "waveform";
};

export type AssetRecord = {
  id: string;
  kind: string;
  metadata?: Record<string, JsonValue>;
} & Record<string, JsonValue | undefined>;

export type BoardNode<Props extends JsonValue = JsonValue> = {
  id: string;
  type: string;
  typeVersion: number;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  assetRefs?: Record<string, AssetRef>;
  props: Props;
};

export type BoardDocument = {
  schemaVersion: number;
  revision: number;
  nodes: BoardNode[];
  assets: AssetRecord[];
  viewport?: ViewportSnapshot;
  metadata?: Record<string, JsonValue>;
};

export type BoardNodeCreateInput<Props extends JsonValue = JsonValue> = Omit<
  BoardNode<Props>,
  "id" | "typeVersion" | "rotation" | "zIndex" | "props"
> & {
  id?: string;
  typeVersion?: number;
  rotation?: number;
  zIndex?: number;
  props?: Props;
};

export type BoardNodePatch<Props extends JsonValue = JsonValue> = Partial<
  Pick<
    BoardNode<Props>,
    | "name"
    | "x"
    | "y"
    | "width"
    | "height"
    | "rotation"
    | "zIndex"
    | "locked"
    | "visible"
    | "assetRefs"
    | "props"
  >
>;

export type ResizeInput<Props extends JsonValue> = {
  node: Readonly<BoardNode<Props>>;
  width: number;
  height: number;
};

/** The eight selection control points, named after compass directions. */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The geometry a resize gesture started from, captured at pointer-down. */
export type NodeGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type NodeResizeRequest = {
  handle: ResizeHandle;
  /** Pointer movement since the gesture started, in world units. */
  deltaWorld: Point;
  /**
   * Geometry at pointer-down. Accumulating against it keeps a long drag exact;
   * omitting it resolves against the node's current geometry instead.
   */
  origin?: NodeGeometry;
  minWidth?: number;
  minHeight?: number;
};

export type ResizePolicy<Props extends JsonValue> =
  | { mode: "free" }
  | { mode: "aspect-ratio"; ratio?: number }
  | { mode: "fixed" }
  | {
      mode: "custom";
      resize(input: ResizeInput<Props>): BoardNodePatch<Props>;
    };

export type NodeTypeDefinition<Props extends JsonValue = JsonValue> = {
  type: string;
  version: number;
  defaults?: Partial<Props>;
  validate(value: unknown): Props;
  getBounds(node: BoardNode<Props>): WorldBounds;
  resize?: ResizePolicy<Props>;
};

export type ChangeOrigin =
  | "api"
  | "ui"
  | "plugin"
  | "agent"
  | "history"
  | "load"
  | (string & {});

export type BoardChangeSet = {
  transactionId: string;
  revision: number;
  label?: string;
  origin: ChangeOrigin;
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodeIds: string[];
  assetChangedNodeIds: string[];
  selectionChanged: boolean;
  viewportChanged: boolean;
  timestamp: number;
};

export type BoardDocumentUpdate = {
  revision: number;
  changedNodes: ReadonlyArray<Readonly<BoardNode>>;
};

export type NodeListFilter = {
  ids?: string[];
  types?: string[];
  type?: string;
  bounds?: WorldBounds;
  visible?: boolean;
  selected?: boolean;
  limit?: number;
};

export type TransactionOptions = {
  origin?: ChangeOrigin;
  /**
   * Merges this transaction into the previous history entry when that entry
   * carries the same key. A pointer gesture that commits once per frame passes
   * one key for the whole gesture so it undoes as a single step; each new
   * gesture must pass a fresh key. Every frame still gets its own revision and
   * ChangeSet — only the history entry is coalesced.
   */
  coalesceKey?: string;
};

export type DocumentLoadOptions = {
  replaceHistory?: boolean;
};
