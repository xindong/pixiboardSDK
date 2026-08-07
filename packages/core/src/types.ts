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
  migrate?(input: {
    fromVersion: number;
    props: unknown;
  }): { version: number; props: Props };
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

export type NodeListFilter = {
  ids?: string[];
  types?: string[];
  type?: string;
  visible?: boolean;
  selected?: boolean;
  limit?: number;
};

export type TransactionOptions = {
  origin?: ChangeOrigin;
};

export type DocumentLoadOptions = {
  migrate?: boolean;
  replaceHistory?: boolean;
};
