import { validateAsset, validateDocument, validateNode } from "./document-validation";
import {
  DocumentValidationError,
  NodeNotFoundError,
  NodeTypeNotRegisteredError,
  TransactionConflictError,
} from "./errors";
import { mergeBounds, rotatedRectBounds } from "./geometry";
import {
  createHistoryController,
  HistoryController,
  type HistoryEntry,
} from "./history";
import { cloneValue, immutableClone, jsonEqual } from "./json";
import { NodeTypeRegistry } from "./node-type-registry";
import { applyDataPatches, type DataPatch } from "./patches";
import { SelectionController, type SelectionChangeEvent } from "./selection";
import { RuntimeDocumentStore } from "./store";
import type {
  AssetRecord,
  BoardChangeSet,
  BoardDocument,
  BoardNode,
  BoardNodeCreateInput,
  BoardNodePatch,
  ChangeOrigin,
  DocumentLoadOptions,
  JsonValue,
  NodeListFilter,
  Point,
  Size,
  TransactionOptions,
  ViewportSnapshot,
  WorldBounds,
} from "./types";
import {
  ViewportController,
  type FitBoundsOptions,
  type ViewportChangeEvent,
} from "./viewport";

export type BoardCoreOptions = {
  document?: unknown;
  schemaVersion?: number;
  nodeTypes?: NodeTypeRegistry;
  viewportSize?: Size;
  idFactory?: () => string;
  now?: () => number;
};

export type BoardChangeEvent = {
  revision: number;
  changeSet: BoardChangeSet;
};

export type MissingNodeTypeEvent = {
  type: string;
  nodeIds: string[];
};

type CoreEventMap = {
  change: BoardChangeEvent;
  "selection:change": SelectionChangeEvent;
  "viewport:change": ViewportChangeEvent;
  "history:change": { canUndo: boolean; canRedo: boolean };
  "node-type:missing": MissingNodeTypeEvent;
};

type ActiveTransaction = {
  id: string;
  label?: string;
  origin: ChangeOrigin;
  draft: RuntimeDocumentStore;
  forward: DataPatch[];
  inverse: DataPatch[];
};

type CoreInternals = {
  mutate<Result>(label: string, operation: (transaction: ActiveTransaction) => Result): Result;
  currentStore(): RuntimeDocumentStore;
  nextId(): string;
  validateLoadedDocument(input: unknown, options?: DocumentLoadOptions): BoardDocument;
  loadDocument(input: unknown, options?: DocumentLoadOptions): BoardChangeSet;
  snapshotDocument(): Readonly<BoardDocument>;
  jsonDocument(): BoardDocument;
  recordPatch(transaction: ActiveTransaction, forward: DataPatch, inverse: DataPatch): void;
};

const coreInternals = new WeakMap<BoardCore, CoreInternals>();

export class BoardCore {
  readonly nodeTypes: NodeTypeRegistry;
  readonly nodes: BoardNodesController;
  readonly assets: BoardAssetsController;
  readonly selection: SelectionController;
  readonly viewport: BoardViewportController;
  readonly history: HistoryController;
  readonly document: BoardDocumentController;

  private store: RuntimeDocumentStore;
  private readonly schemaVersion: number;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly events = new EventHub<CoreEventMap>();
  private activeTransaction?: ActiveTransaction;
  private rejectedAsyncTransactionCallbacks = 0;
  private readonly viewportState: ViewportController;
  private readonly recordHistory: (entry: HistoryEntry) => void;

  constructor(options: BoardCoreOptions = {}) {
    this.nodeTypes = options.nodeTypes ?? new NodeTypeRegistry();
    this.schemaVersion = options.schemaVersion ?? 1;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? Date.now;

    const document = options.document
      ? validateDocument(options.document, {
          schemaVersion: this.schemaVersion,
          nodeTypes: this.nodeTypes,
        })
      : createEmptyDocument(this.schemaVersion);
    this.store = new RuntimeDocumentStore(document);
    this.viewportState = new ViewportController(
      document.viewport ?? { scale: 1, offset: { x: 0, y: 0 } },
      options.viewportSize,
      () => this.assertSessionMutationAllowed(),
    );

    coreInternals.set(this, {
      mutate: (label, operation) => this.mutate(label, operation),
      currentStore: () => this.currentStore(),
      nextId: () => this.nextId(),
      validateLoadedDocument: (input, loadOptions) =>
        this.validateLoadedDocument(input, loadOptions),
      loadDocument: (input, loadOptions) => this.loadDocument(input, loadOptions),
      snapshotDocument: () => this.snapshotDocument(),
      jsonDocument: () => this.jsonDocument(),
      recordPatch: (transaction, forward, inverse) =>
        this.recordPatch(transaction, forward, inverse),
    });

    this.selection = new SelectionController(
      (id) => this.currentStore().getNode(id) !== undefined,
      () => this.assertSessionMutationAllowed(),
    );
    this.viewport = new BoardViewportController(this, this.viewportState);
    const history = createHistoryController({
      applyHistoryEntry: (entry, direction) => this.applyHistoryEntry(entry, direction),
    });
    this.history = history.controller;
    this.recordHistory = history.record;
    this.nodes = new BoardNodesController(this);
    this.assets = new BoardAssetsController(this);
    this.document = new BoardDocumentController(this);

    this.selection.onChange((event) => this.events.emit("selection:change", event));
    this.viewportState.onChange((event) => {
      this.events.emit("viewport:change", event);
    });
    this.history.onChange((event) => this.events.emit("history:change", event));
  }

  on<EventName extends keyof CoreEventMap>(
    eventName: EventName,
    listener: (event: CoreEventMap[EventName]) => void,
  ): () => void {
    return this.events.on(eventName, listener);
  }

  transaction<Result>(
    label: string,
    operation: (core: BoardCore) => Result,
    options: TransactionOptions = {},
  ): Result {
    if (this.activeTransaction) {
      throw new TransactionConflictError("Nested transactions are not supported");
    }
    if (this.rejectedAsyncTransactionCallbacks > 0) {
      throw new TransactionConflictError(
        "Writes are blocked until a rejected async transaction callback settles",
      );
    }
    const transaction: ActiveTransaction = {
      id: this.idFactory(),
      label: label || undefined,
      origin: options.origin ?? "api",
      draft: this.store.clone(),
      forward: [],
      inverse: [],
    };
    this.activeTransaction = transaction;

    try {
      const result = operation(this);
      if (isPromiseLike(result)) {
        this.rejectedAsyncTransactionCallbacks += 1;
        void Promise.resolve(result)
          .catch(() => undefined)
          .finally(() => {
            this.rejectedAsyncTransactionCallbacks -= 1;
          });
        throw new TransactionConflictError(
          "Core transaction callbacks must be synchronous",
        );
      }
      this.activeTransaction = undefined;
      this.commitTransaction(transaction, true);
      return result;
    } catch (error) {
      this.activeTransaction = undefined;
      throw error;
    }
  }

  private applyHistoryEntry(entry: HistoryEntry, direction: "undo" | "redo"): BoardChangeSet {
    if (this.activeTransaction || this.rejectedAsyncTransactionCallbacks > 0) {
      throw new TransactionConflictError("History cannot run during a transaction");
    }
    const transaction: ActiveTransaction = {
      id: this.idFactory(),
      label: `${direction === "undo" ? "Undo" : "Redo"}${entry.label ? `: ${entry.label}` : ""}`,
      origin: "history",
      draft: this.store.clone(),
      forward: [],
      inverse: [],
    };
    applyDataPatches(transaction.draft, direction === "undo" ? entry.inverse : entry.forward);
    return this.commitTransaction(transaction, false)!;
  }

  getBounds(nodeId: string): WorldBounds {
    const node = this.currentStore().requireNode(nodeId);
    return this.nodeTypes.has(node.type)
      ? this.nodeTypes.getBounds(node)
      : rotatedRectBounds(node);
  }

  private mutate<Result>(label: string, operation: (transaction: ActiveTransaction) => Result): Result {
    if (this.rejectedAsyncTransactionCallbacks > 0) {
      throw new TransactionConflictError(
        "Writes are blocked until a rejected async transaction callback settles",
      );
    }
    if (this.activeTransaction) return operation(this.activeTransaction);
    let result!: Result;
    this.transaction(label, () => {
      result = operation(this.activeTransaction!);
    });
    return result;
  }

  private currentStore(): RuntimeDocumentStore {
    return this.activeTransaction?.draft ?? this.store;
  }

  private nextId(): string {
    return this.idFactory();
  }

  private validateLoadedDocument(input: unknown, options: DocumentLoadOptions = {}): BoardDocument {
    return validateDocument(input, {
      schemaVersion: this.schemaVersion,
      nodeTypes: this.nodeTypes,
    });
  }

  private loadDocument(input: unknown, options: DocumentLoadOptions = {}): BoardChangeSet {
    if (this.activeTransaction || this.rejectedAsyncTransactionCallbacks > 0) {
      throw new TransactionConflictError("A document cannot be loaded during a transaction");
    }
    if (options.replaceHistory === false) {
      throw new DocumentValidationError(
        "replaceHistory:false is not supported because history patches belong to the previous document",
      );
    }
    const nextDocument = this.validateLoadedDocument(input, options);
    const before = this.store.mutableSnapshot();
    const previousViewport = this.viewportState.get();
    const hadSelection = this.selection.get().length > 0;
    this.store = new RuntimeDocumentStore(nextDocument);
    this.selection.clear();
    this.viewportState.set(nextDocument.viewport ?? { scale: 1, offset: { x: 0, y: 0 } });
    this.history.clear();

    const viewportChanged = !jsonEqual(previousViewport, this.viewportState.get());
    const changeSet = createChangeSet({
      before,
      after: nextDocument,
      transactionId: this.idFactory(),
      origin: "load",
      revision: nextDocument.revision,
      timestamp: this.now(),
      selectionChanged: hadSelection,
      viewportChanged,
    });
    this.emitChange(changeSet);
    this.emitMissingNodeTypes(nextDocument.nodes);
    return changeSet;
  }

  private snapshotDocument(): Readonly<BoardDocument> {
    return this.store.snapshot();
  }

  private jsonDocument(): BoardDocument {
    return this.store.mutableSnapshot();
  }

  private recordPatch(transaction: ActiveTransaction, forward: DataPatch, inverse: DataPatch): void {
    transaction.forward.push(cloneValue(forward));
    transaction.inverse.unshift(cloneValue(inverse));
  }

  private commitTransaction(
    transaction: ActiveTransaction,
    recordHistory: boolean,
  ): BoardChangeSet | undefined {
    if (transaction.forward.length === 0 && recordHistory) return undefined;
    const before = this.store.mutableSnapshot();
    const after = transaction.draft.mutableSnapshot();
    if (jsonEqual(before.nodes, after.nodes) && jsonEqual(before.assets, after.assets)) {
      return undefined;
    }

    transaction.draft.revision = before.revision + 1;
    this.store.replaceWith(transaction.draft);
    const selectionChanged = this.selection.prune();
    const committed = this.store.mutableSnapshot();
    const changeSet = createChangeSet({
      before,
      after: committed,
      transactionId: transaction.id,
      label: transaction.label,
      origin: transaction.origin,
      revision: committed.revision,
      timestamp: this.now(),
      selectionChanged,
      viewportChanged: false,
    });

    if (recordHistory) {
      this.recordHistory({
        label: transaction.label,
        origin: transaction.origin,
        forward: transaction.forward,
        inverse: transaction.inverse,
      });
    }
    this.emitChange(changeSet);
    return changeSet;
  }

  private emitChange(changeSet: BoardChangeSet): void {
    this.events.emit("change", {
      revision: changeSet.revision,
      changeSet: immutableClone(changeSet) as BoardChangeSet,
    });
  }

  private emitMissingNodeTypes(nodes: BoardNode[]): void {
    const missing = new Map<string, string[]>();
    for (const node of nodes) {
      if (this.nodeTypes.has(node.type)) continue;
      const ids = missing.get(node.type) ?? [];
      ids.push(node.id);
      missing.set(node.type, ids);
    }
    for (const [type, nodeIds] of missing) {
      this.events.emit("node-type:missing", { type, nodeIds: [...nodeIds] });
    }
  }

  private assertSessionMutationAllowed(): void {
    if (this.activeTransaction || this.rejectedAsyncTransactionCallbacks > 0) {
      throw new TransactionConflictError(
        "Selection and viewport cannot change during a document transaction",
      );
    }
  }
}

export class BoardNodesController {
  constructor(private readonly core: BoardCore) {}

  create<Props extends JsonValue>(input: BoardNodeCreateInput<Props>): Readonly<BoardNode<Props>> {
    const internals = getCoreInternals(this.core);
    return internals.mutate("Create node", (transaction) => {
      const { typeVersion, props } = this.core.nodeTypes.createProps(input.type, input.props);
      const node = validateNode({
        id: input.id ?? internals.nextId(),
        type: input.type,
        typeVersion: input.typeVersion ?? typeVersion,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        rotation: input.rotation ?? 0,
        zIndex: input.zIndex ?? 0,
        props,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.locked === undefined ? {} : { locked: input.locked }),
        ...(input.visible === undefined ? {} : { visible: input.visible }),
        ...(input.assetRefs === undefined ? {} : { assetRefs: cloneValue(input.assetRefs) }),
      }) as BoardNode<Props>;
      const validated = this.core.nodeTypes.validateNode(node);
      const index = transaction.draft.listNodes().length;
      transaction.draft.insertNode(index, validated);
      internals.recordPatch(
        transaction,
        { op: "node:insert", index, node: validated },
        { op: "node:remove", nodeId: validated.id },
      );
      return immutableClone(validated);
    });
  }

  update<Props extends JsonValue>(
    nodeId: string,
    patch: BoardNodePatch<Props>,
  ): Readonly<BoardNode<Props>> {
    const internals = getCoreInternals(this.core);
    return internals.mutate("Update node", (transaction) => {
      const previous = transaction.draft.requireNode(nodeId) as BoardNode<Props>;
      if ("props" in patch && !this.core.nodeTypes.has(previous.type)) {
        throw new NodeTypeNotRegisteredError(previous.type);
      }
      const next = validateNode({ ...previous, ...cloneValue(patch), id: previous.id, type: previous.type }) as BoardNode<Props>;
      const validated = this.core.nodeTypes.has(next.type)
        ? this.core.nodeTypes.validateNode(next)
        : next;
      if (jsonEqual(previous, validated)) return immutableClone(previous);
      transaction.draft.replaceNode(validated);
      internals.recordPatch(
        transaction,
        { op: "node:replace", node: validated },
        { op: "node:replace", node: previous },
      );
      return immutableClone(validated);
    });
  }

  remove(nodeId: string): Readonly<BoardNode> {
    const internals = getCoreInternals(this.core);
    return internals.mutate("Remove node", (transaction) => {
      const index = transaction.draft.getNodeIndex(nodeId);
      if (index === undefined) throw new NodeNotFoundError(nodeId);
      const removed = transaction.draft.removeNode(nodeId);
      internals.recordPatch(
        transaction,
        { op: "node:remove", nodeId },
        { op: "node:insert", index, node: removed },
      );
      return immutableClone(removed);
    });
  }

  get<Props extends JsonValue = JsonValue>(nodeId: string): Readonly<BoardNode<Props>> | undefined {
    const node = getCoreInternals(this.core).currentStore().getNode(nodeId) as BoardNode<Props> | undefined;
    return node ? immutableClone(node) : undefined;
  }

  list(filter: NodeListFilter = {}): ReadonlyArray<Readonly<BoardNode>> {
    const selected = new Set(this.core.selection.get());
    const idFilter = filter.ids ? new Set(filter.ids) : undefined;
    const typeFilter = filter.types ? new Set(filter.types) : undefined;
    const limit = filter.limit ?? Number.POSITIVE_INFINITY;
    if (!Number.isInteger(limit) && limit !== Number.POSITIVE_INFINITY) {
      throw new RangeError("Node list limit must be an integer");
    }
    if (limit < 0) throw new RangeError("Node list limit must not be negative");

    const result = getCoreInternals(this.core).currentStore().listNodes().filter((node) => {
      if (idFilter && !idFilter.has(node.id)) return false;
      if (typeFilter && !typeFilter.has(node.type)) return false;
      if (filter.type && node.type !== filter.type) return false;
      if (filter.visible !== undefined && (node.visible ?? true) !== filter.visible) return false;
      if (filter.selected !== undefined && selected.has(node.id) !== filter.selected) return false;
      return true;
    });
    return immutableClone(result.slice(0, limit));
  }
}

export class BoardAssetsController {
  constructor(private readonly core: BoardCore) {}

  upsert(assetInput: AssetRecord): Readonly<AssetRecord> {
    const internals = getCoreInternals(this.core);
    return internals.mutate("Upsert asset", (transaction) => {
      const asset = validateAsset(assetInput);
      const previous = transaction.draft.getAsset(asset.id);
      if (previous && jsonEqual(previous, asset)) return immutableClone(previous);
      if (previous) {
        transaction.draft.replaceAsset(asset);
        internals.recordPatch(
          transaction,
          { op: "asset:replace", asset },
          { op: "asset:replace", asset: previous },
        );
      } else {
        const index = transaction.draft.listAssets().length;
        transaction.draft.insertAsset(index, asset);
        internals.recordPatch(
          transaction,
          { op: "asset:insert", index, asset },
          { op: "asset:remove", assetId: asset.id },
        );
      }
      return immutableClone(asset);
    });
  }

  remove(assetId: string): Readonly<AssetRecord> {
    const internals = getCoreInternals(this.core);
    return internals.mutate("Remove asset", (transaction) => {
      const index = transaction.draft.getAssetIndex(assetId);
      if (index === undefined) throw new DocumentValidationError(`Asset not found: ${assetId}`);
      const asset = transaction.draft.removeAsset(assetId);
      internals.recordPatch(
        transaction,
        { op: "asset:remove", assetId },
        { op: "asset:insert", index, asset },
      );
      return immutableClone(asset);
    });
  }

  get(assetId: string): Readonly<AssetRecord> | undefined {
    const asset = getCoreInternals(this.core).currentStore().getAsset(assetId);
    return asset ? immutableClone(asset) : undefined;
  }

  list(): ReadonlyArray<Readonly<AssetRecord>> {
    return immutableClone(getCoreInternals(this.core).currentStore().listAssets());
  }
}

export class BoardViewportController {
  constructor(
    private readonly core: BoardCore,
    private readonly viewport: ViewportController,
  ) {}

  get(): ViewportSnapshot {
    return this.viewport.get();
  }

  set(value: ViewportSnapshot): void {
    this.viewport.set(value);
  }

  setScreenSize(size: Size): void {
    this.viewport.setScreenSize(size);
  }

  panBy(deltaX: number, deltaY: number): void {
    this.viewport.panBy(deltaX, deltaY);
  }

  zoomAt(screenPoint: Point, factor: number): void {
    this.viewport.zoomAt(screenPoint, factor);
  }

  fitNodes(nodeIds: string[], options?: FitBoundsOptions): void {
    const bounds = mergeBounds(nodeIds.map((nodeId) => this.core.getBounds(nodeId)));
    if (!bounds) return;
    this.viewport.fitBounds(bounds, options);
  }

  fitBounds(bounds: WorldBounds, options?: FitBoundsOptions): void {
    this.viewport.fitBounds(bounds, options);
  }

  toWorld(screenPoint: Point): Point {
    return this.viewport.toWorld(screenPoint);
  }

  toScreen(worldPoint: Point): Point {
    return this.viewport.toScreen(worldPoint);
  }

  onChange(listener: (event: ViewportChangeEvent) => void): () => void {
    return this.viewport.onChange(listener);
  }
}

export class BoardDocumentController {
  constructor(private readonly core: BoardCore) {}

  snapshot(): Readonly<BoardDocument> {
    return getCoreInternals(this.core).snapshotDocument();
  }

  toJSON(): BoardDocument {
    return getCoreInternals(this.core).jsonDocument();
  }

  stringify(space?: number): string {
    return JSON.stringify(this.toJSON(), null, space);
  }

  load(input: unknown, options?: DocumentLoadOptions): BoardChangeSet {
    return getCoreInternals(this.core).loadDocument(input, options);
  }

  validate(input: unknown): BoardDocument {
    return getCoreInternals(this.core).validateLoadedDocument(input);
  }
}

export function createBoardCore(options?: BoardCoreOptions): BoardCore {
  return new BoardCore(options);
}

function getCoreInternals(core: BoardCore): CoreInternals {
  const internals = coreInternals.get(core);
  if (!internals) throw new Error("BoardCore internals are unavailable");
  return internals;
}

function createEmptyDocument(schemaVersion: number): BoardDocument {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new DocumentValidationError("schemaVersion must be a positive integer");
  }
  return { schemaVersion, revision: 0, nodes: [], assets: [] };
}

function defaultIdFactory(): string {
  return globalThis.crypto.randomUUID();
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function createChangeSet(input: {
  before: BoardDocument;
  after: BoardDocument;
  transactionId: string;
  revision: number;
  label?: string;
  origin: ChangeOrigin;
  timestamp: number;
  selectionChanged: boolean;
  viewportChanged: boolean;
}): BoardChangeSet {
  const beforeNodes = new Map(input.before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(input.after.nodes.map((node) => [node.id, node]));
  const beforeNodeOrder = new Map(input.before.nodes.map((node, index) => [node.id, index]));
  const addedNodeIds = input.after.nodes
    .filter((node) => !beforeNodes.has(node.id))
    .map((node) => node.id);
  const updatedNodeIds = input.after.nodes
    .filter((node, index) => {
      const previous = beforeNodes.get(node.id);
      return (
        previous !== undefined &&
        (!jsonEqual(previous, node) || beforeNodeOrder.get(node.id) !== index)
      );
    })
    .map((node) => node.id);
  const removedNodeIds = input.before.nodes
    .filter((node) => !afterNodes.has(node.id))
    .map((node) => node.id);

  const beforeAssets = new Map(input.before.assets.map((asset) => [asset.id, asset]));
  const afterAssets = new Map(input.after.assets.map((asset) => [asset.id, asset]));
  const changedAssetIds = new Set<string>();
  for (const asset of input.before.assets) {
    const next = afterAssets.get(asset.id);
    if (!next || !jsonEqual(asset, next)) changedAssetIds.add(asset.id);
  }
  for (const asset of input.after.assets) {
    const previous = beforeAssets.get(asset.id);
    if (!previous || !jsonEqual(previous, asset)) changedAssetIds.add(asset.id);
  }

  const assetChangedNodeIds = input.after.nodes
    .filter((node) => {
      const previous = beforeNodes.get(node.id);
      if (previous && !jsonEqual(previous.assetRefs, node.assetRefs)) return true;
      return Object.values(node.assetRefs ?? {}).some((ref) => changedAssetIds.has(ref.assetId));
    })
    .map((node) => node.id);

  return {
    transactionId: input.transactionId,
    revision: input.revision,
    ...(input.label ? { label: input.label } : {}),
    origin: input.origin,
    addedNodeIds,
    updatedNodeIds,
    removedNodeIds,
    assetChangedNodeIds,
    selectionChanged: input.selectionChanged,
    viewportChanged: input.viewportChanged,
    timestamp: input.timestamp,
  };
}

class EventHub<EventMap extends object> {
  private readonly listeners = new Map<keyof EventMap, Set<(event: never) => void>>();

  on<EventName extends keyof EventMap>(
    eventName: EventName,
    listener: (event: EventMap[EventName]) => void,
  ): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.listeners.set(eventName, listeners);
    return () => listeners.delete(listener as (event: never) => void);
  }

  emit<EventName extends keyof EventMap>(eventName: EventName, event: EventMap[EventName]): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      try {
        listener(event as never);
      } catch {
        // Public listeners observe committed state and cannot invalidate the commit.
      }
    }
  }
}
