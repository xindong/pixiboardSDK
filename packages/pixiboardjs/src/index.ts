import {
  BoardCore,
  NodeNotFoundError,
  type BoardChangeEvent,
  type BoardNode,
  type BoardNodePatch,
  type JsonValue,
  type NodeTypeDefinition as InternalNodeTypeDefinition,
} from "@pixi-board/core";
import {
  CapabilityUnavailableError,
  createBoardCapabilities,
  type BoardCapabilities,
  type RequestOptions,
} from "@pixi-board/capabilities";
import {
  NodeRendererRegistry,
  PixiBoardRenderer,
  type PixiBoardRendererOptions as InternalRendererOptions,
  type PixiNodeRenderer as InternalNodeRenderer,
} from "@pixi-board/renderer-pixi";
import { BoardDestroyedError } from "./errors";
import { TransformController } from "./transform";
import type {
  BoardLifecycleState,
  CaptureInput,
  CustomNodeRendererRegistry,
  NodeQuery,
  NodeHandle,
  NodeResizeRequest,
  PublicNodeTypeDefinition,
  PixiBoard,
  PixiBoardOptions,
  PublicBoardEventMap,
  RuntimeRenderer,
} from "./types";

export * from "./errors";
export type * from "./types";
// Re-exported so a host can compute handle placement and cursors itself when
// it draws the transformer inside its own scene instead of over the DOM.
export {
  RESIZE_HANDLES,
  resizeHandleAxes,
  resizeHandleCursor,
} from "@pixi-board/core";
export {
  DocumentValidationError,
  NodeNotFoundError,
  NodeTypeNotRegisteredError,
  NodeValidationError,
  TransactionConflictError,
} from "@pixi-board/core";
export {
  AssetUnavailableError,
  CapabilityError,
  CapabilityUnavailableError,
  PermissionDeniedError,
} from "@pixi-board/capabilities";

type Listener = (event: never) => void;
let focusedBoard: PixiBoardFacade | undefined;

/**
 * World-unit margin kept around the viewport so a node that scrolls into view
 * already has a built view. Matches GridSpatialIndex's default cell size, so
 * the padded query typically costs one extra ring of cells.
 */
const DEFAULT_VIRTUALIZATION_PADDING = 256;

class EventHub {
  private readonly listeners = new Map<keyof PublicBoardEventMap | string, Set<Listener>>();

  on<EventName extends keyof PublicBoardEventMap>(
    eventName: EventName,
    listener: (event: PublicBoardEventMap[EventName]) => void,
  ): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(eventName, listeners);
    return () => listeners.delete(listener as Listener);
  }

  emit(eventName: keyof PublicBoardEventMap | string, event: unknown): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      try { listener(event as never); } catch { /* observers cannot break runtime */ }
    }
  }

  clear(): void { this.listeners.clear(); }
}

class PublicNodeHandle<Props extends JsonValue = JsonValue> implements NodeHandle<Props> {
  constructor(private readonly board: PixiBoardFacade, readonly id: string) {}

  getAttrs(): Readonly<BoardNode<Props>> {
    const node = this.board.getNode<Props>(this.id);
    if (!node) throw new NodeNotFoundError(this.id);
    return node;
  }

  setAttrs(patch: BoardNodePatch<Props>): this {
    this.board.setNodeAttrs(this.id, patch);
    return this;
  }

  x(): number;
  x(value: number): this;
  x(value?: number): number | this { return this.attr("x", value); }
  y(): number;
  y(value: number): this;
  y(value?: number): number | this { return this.attr("y", value); }
  width(): number;
  width(value: number): this;
  width(value?: number): number | this { return this.attr("width", value); }
  height(): number;
  height(value: number): this;
  height(value?: number): number | this { return this.attr("height", value); }
  rotation(): number;
  rotation(value: number): this;
  rotation(value?: number): number | this { return this.attr("rotation", value); }
  visible(): boolean;
  visible(value: boolean): this;
  visible(value?: boolean): boolean | this {
    if (value === undefined) return this.getAttrs().visible ?? true;
    this.setAttrs({ visible: value });
    return this;
  }

  remove(): void { this.board.removeNode(this.id); }

  on(eventName: "change", listener: (event: BoardChangeEvent) => void): () => void {
    return this.board.onNode(this.id, eventName, listener);
  }

  private attr<Key extends "x" | "y" | "width" | "height" | "rotation">(
    key: Key,
    value?: number,
  ): number | this {
    if (value === undefined) return this.getAttrs()[key];
    this.setAttrs({ [key]: value } as BoardNodePatch<Props>);
    return this;
  }
}

class PixiBoardFacade implements PixiBoard {
  readonly ready: Promise<void>;
  readonly signal: AbortSignal;
  readonly capabilities: BoardCapabilities;
  readonly nodes: PixiBoard["nodes"];
  readonly nodeTypes: PixiBoard["nodeTypes"];
  readonly transform: PixiBoard["transform"];
  readonly selection: PixiBoard["selection"];
  readonly viewport: PixiBoard["viewport"];
  readonly history: PixiBoard["history"];
  readonly document: PixiBoard["document"];

  private lifecycle: BoardLifecycleState = "created";
  private readonly abortController = new AbortController();
  private readonly core: BoardCore;
  private readonly events = new EventHub();
  private readonly nodeEvents = new EventHub();
  private readonly cleanup = new Set<() => void>();
  private readonly options: PixiBoardOptions;
  private readonly rendererRegistry: NodeRendererRegistry;
  private readonly transformController: TransformController;
  private renderer?: RuntimeRenderer;
  private renderedRevision = 0;
  private frameId = 0;
  private pendingRuntimeWork = Promise.resolve();
  private destroyPromise?: Promise<void>;
  private transactionDepth = 0;
  private transformSequence = 0;

  constructor(options: PixiBoardOptions) {
    const rendererRegistry = (options.renderer?.registry as unknown as NodeRendererRegistry | undefined) ?? new NodeRendererRegistry();
    this.rendererRegistry = rendererRegistry;
    this.options = {
      ...options,
      renderer: {
        ...options.renderer,
        registry: rendererRegistry as unknown as CustomNodeRendererRegistry,
      },
    };
    this.signal = this.abortController.signal;
    this.core = new BoardCore({ ...this.options.core, document: this.options.document });
    const capabilities = createBoardCapabilities(this.core, {
      preview: options.preview,
      capture: options.capture,
    });
    this.capabilities = scopeCapabilities(capabilities, this.signal, () => this.assertAlive());

    this.nodes = {
      create: async <Props extends JsonValue>(input: Parameters<PixiBoard["nodes"]["create"]>[0]) => {
        this.assertAlive();
        const node = this.core.nodes.create(input as never);
        return this.node<Props>(node.id);
      },
      update: <Props extends JsonValue>(nodeId: string, patch: BoardNodePatch<Props>) => {
        this.updateNode(nodeId, patch);
        return this.node<Props>(nodeId);
      },
      resize: <Props extends JsonValue>(nodeId: string, request: NodeResizeRequest) => {
        this.assertAlive();
        this.core.nodes.resize<Props>(nodeId, request);
        return this.node<Props>(nodeId);
      },
      remove: (nodeId) => this.removeNode(nodeId),
      get: <Props extends JsonValue = JsonValue>(nodeId: string) => this.getNode<Props>(nodeId),
      list: (filter = {}) => { this.assertAlive(); return this.core.nodes.list(filter); },
    };
    this.nodeTypes = {
      register: <Props extends JsonValue, State = unknown>(
        definition: PublicNodeTypeDefinition<Props, State>,
        registrationOptions = {},
      ) => this.registerNodeType(definition, registrationOptions),
      has: (type) => { this.assertAlive(); return this.core.nodeTypes.has(type); },
      get: (type) => { this.assertAlive(); return this.core.nodeTypes.get(type); },
      list: () => { this.assertAlive(); return this.core.nodeTypes.list(); },
    };
    this.transformController = new TransformController({
      selection: () => this.core.selection.get(),
      getNode: (nodeId) => this.core.nodes.get(nodeId),
      resizePolicy: (type) => this.core.nodeTypes.get(type)?.resize,
      resize: (nodeId, request) => { this.core.nodes.resize(nodeId, request); },
      update: (nodeId, patch) => { this.core.nodes.update(nodeId, patch); },
      transaction: (label, operation, transactionOptions) =>
        this.transaction(label, operation, transactionOptions),
      nextId: () => `${++this.transformSequence}`,
    }, this.options.transform ?? {});
    this.transform = {
      handles: () => { this.assertAlive(); return this.transformController.handles(); },
      bounds: () => { this.assertAlive(); return this.transformController.bounds(); },
      begin: (handle) => { this.assertAlive(); return this.transformController.begin(handle); },
      active: () => this.transformController.active(),
    };
    this.selection = {
      get: () => { this.assertAlive(); return this.core.selection.get(); },
      set: (ids) => { this.assertAlive(); this.core.selection.set(ids); },
      toggle: (id) => { this.assertAlive(); this.core.selection.toggle(id); },
      clear: () => { this.assertAlive(); this.core.selection.clear(); },
      onChange: (listener) => this.on("selection:change", listener),
    };
    this.viewport = {
      get: () => { this.assertAlive(); return this.core.viewport.get(); },
      set: (value) => { this.assertAlive(); this.core.viewport.set(value); },
      panBy: (x, y) => { this.assertAlive(); this.core.viewport.panBy(x, y); },
      zoomAt: (point, factor) => { this.assertAlive(); this.core.viewport.zoomAt(point, factor); },
      fitNodes: (ids) => { this.assertAlive(); this.core.viewport.fitNodes(ids); },
      fitBounds: (bounds) => { this.assertAlive(); this.core.viewport.fitBounds(bounds); },
      toWorld: (point) => { this.assertAlive(); return this.core.viewport.toWorld(point); },
      toScreen: (point) => { this.assertAlive(); return this.core.viewport.toScreen(point); },
    };
    this.history = {
      canUndo: () => { this.assertAlive(); return this.core.history.canUndo(); },
      canRedo: () => { this.assertAlive(); return this.core.history.canRedo(); },
      undo: () => { this.assertAlive(); return this.core.history.undo(); },
      redo: () => { this.assertAlive(); return this.core.history.redo(); },
      clear: () => { this.assertAlive(); this.core.history.clear(); },
    };
    this.document = {
      snapshot: () => { this.assertAlive(); return this.core.document.snapshot(); },
      toJSON: () => { this.assertAlive(); return this.core.document.toJSON(); },
      load: async (input, loadOptions) => {
        this.assertAlive();
        this.core.document.load(input, loadOptions);
        await this.pendingRuntimeWork;
      },
      validate: (input) => {
        this.assertAlive();
        return this.core.document.validate(input);
      },
    };

    this.bindCoreEvents();
    this.bindRuntimePorts();
    this.ready = this.mount();
  }

  get state(): BoardLifecycleState { return this.lifecycle; }

  node<Props extends JsonValue = JsonValue>(nodeId: string): NodeHandle<Props> {
    this.assertAlive();
    return new PublicNodeHandle<Props>(this, nodeId);
  }

  find(filter: NodeQuery = {}): ReadonlyArray<Readonly<BoardNode>> {
    this.assertAlive();
    return this.core.nodes.list(filter);
  }

  findOne(selector: string): Readonly<BoardNode> | undefined {
    this.assertAlive();
    const nodeId = selector.startsWith("#") ? selector.slice(1) : selector;
    if (!nodeId) return undefined;
    return this.core.nodes.get(nodeId);
  }

  visibleNodeIds(): ReadonlySet<string> | undefined {
    this.assertAlive();
    // A renderer that does not implement culling reports undefined, which
    // flows straight through: "no culling information" is the honest answer,
    // and callers turn it into "everything is visible".
    return this.renderer?.visibleNodeIds?.();
  }

  transaction<Result>(label: string, operation: () => Result, options = {}): Result {
    this.assertAlive();
    return this.core.transaction(label, () => {
      this.transactionDepth += 1;
      try { return operation(); } finally { this.transactionDepth -= 1; }
    }, options);
  }

  on<EventName extends keyof PublicBoardEventMap>(
    eventName: EventName,
    listener: (event: PublicBoardEventMap[EventName]) => void,
  ): () => void {
    this.assertAlive();
    return this.events.on(eventName, listener);
  }

  focus(): void {
    this.assertAlive();
    focusedBoard = this;
    const container = this.options.container as (Element & { focus?: () => void }) | null | undefined;
    container?.focus?.();
  }

  async capture(input: CaptureInput, options: RequestOptions = {}) {
    this.assertAlive();
    if (!this.capabilities.capture.available) throw new CapabilityUnavailableError("capture");
    const signal = mergeSignals(this.signal, options.signal);
    return this.capabilities.capture.capture(input as never, { ...options, signal });
  }

  getNode<Props extends JsonValue>(nodeId: string): Readonly<BoardNode<Props>> | undefined {
    this.assertAlive();
    return this.core.nodes.get<Props>(nodeId);
  }

  updateNode<Props extends JsonValue>(nodeId: string, patch: BoardNodePatch<Props>): void {
    this.assertAlive();
    this.core.nodes.update(nodeId, patch);
  }

  setNodeAttrs<Props extends JsonValue>(nodeId: string, patch: BoardNodePatch<Props>): void {
    if (this.transactionDepth > 0) this.updateNode(nodeId, patch);
    else this.transaction("Update node attrs", () => this.updateNode(nodeId, patch));
  }

  removeNode(nodeId: string): void {
    this.assertAlive();
    this.core.nodes.remove(nodeId);
  }

  private async registerNodeType<Props extends JsonValue, State = unknown>(
    definition: PublicNodeTypeDefinition<Props, State>,
    registrationOptions: { replace?: boolean },
  ): Promise<() => Promise<void>> {
    this.assertAlive();
    if (registrationOptions.replace) {
      throw new Error("Public node type replacement is not supported; unregister the current definition first");
    }
    const { renderer, ...dataDefinition } = definition;
    const unregisterData = this.core.nodeTypes.register(
      dataDefinition as InternalNodeTypeDefinition<Props>,
      registrationOptions,
    );
    let unregisterRenderer: (() => void) | undefined;
    try {
      if (renderer) {
        unregisterRenderer = this.rendererRegistry.register(
          definition.type,
          renderer as unknown as InternalNodeRenderer<Props, State>,
          registrationOptions,
        );
      }
      await this.refreshRendererTypes();
    } catch (error) {
      unregisterRenderer?.();
      unregisterData();
      try {
        await this.refreshRendererTypes();
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Node type registration and renderer rollback both failed");
      }
      throw error;
    }
    let active = true;
    return async () => {
      if (!active) return;
      unregisterRenderer?.();
      unregisterData();
      await this.refreshRendererTypes();
      active = false;
    };
  }

  private refreshRendererTypes(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer?.refreshRegisteredTypes) return Promise.resolve();
    const work = this.pendingRuntimeWork.then(async () => {
      if (!this.signal.aborted) await renderer.refreshRegisteredTypes?.();
    });
    this.pendingRuntimeWork = work.catch(() => undefined);
    return work;
  }

  onNode(nodeId: string, eventName: "change", listener: (event: BoardChangeEvent) => void): () => void {
    this.assertAlive();
    return this.nodeEvents.on(`${nodeId}:${eventName}` as never, listener as never);
  }

  async destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyPromise = this.performDestroy();
    return this.destroyPromise;
  }

  private async mount(): Promise<void> {
    this.lifecycle = "mounting";
    const persistence = this.options.persistence;
    if (persistence?.load) {
      const loaded = await persistence.load({ signal: this.signal });
      if (loaded && !this.signal.aborted) this.core.document.load(loaded);
    }
    if (this.signal.aborted) return;
    if (!this.options.headless && this.options.container) {
      const factory = this.options.rendererFactory ?? ((rendererOptions) => new PixiBoardRenderer(rendererOptions as unknown as InternalRendererOptions));
      const renderer = factory({ ...this.options.renderer, nodeTypes: this.core.nodeTypes });
      await renderer.init();
      if (this.signal.aborted) { await renderer.destroy(); return; }
      this.renderer = renderer;
      // Before the first rebuild, so the initial scene only builds views for
      // what is actually on screen instead of the whole document.
      await this.syncVisibleBounds();
      const snapshot = this.core.document.snapshot();
      await renderer.rebuild(snapshot);
      this.renderedRevision = snapshot.revision;
    }
    if (!this.signal.aborted) this.lifecycle = "ready";
  }

  private bindCoreEvents(): void {
    this.cleanup.add(this.core.on("change", (event) => this.queueChange(event)));
    this.cleanup.add(this.core.on("selection:change", (event) => {
      if (!this.signal.aborted) this.events.emit("selection:change", event);
    }));
    this.cleanup.add(this.core.on("viewport:change", (event) => {
      if (!this.signal.aborted) this.events.emit("viewport:change", event);
      this.queueVisibleBoundsSync();
    }));
    this.cleanup.add(this.core.on("history:change", (event) => {
      if (!this.signal.aborted) this.events.emit("history:change", event);
    }));
  }

  private bindRuntimePorts(): void {
    const eventPort = this.options.ports?.events;
    if (eventPort && this.options.interactions?.keyboard) {
      const listener: EventListener = (event) => {
        if (focusedBoard === this) this.options.ports?.onKeyboardEvent?.(event);
      };
      eventPort.addEventListener("keydown", listener);
      this.cleanup.add(() => eventPort.removeEventListener("keydown", listener));
    }
    if (eventPort && this.options.interactions?.clipboard) {
      for (const type of ["copy", "cut", "paste"]) {
        const listener: EventListener = (event) => {
          if (focusedBoard === this) this.options.ports?.onClipboardEvent?.(event);
        };
        eventPort.addEventListener(type, listener);
        this.cleanup.add(() => eventPort.removeEventListener(type, listener));
      }
    }
    const pointerTarget = this.options.container;
    if (pointerTarget && this.options.interactions?.pointer) {
      const listener: EventListener = () => { focusedBoard = this; };
      pointerTarget.addEventListener("pointerdown", listener);
      this.cleanup.add(() => pointerTarget.removeEventListener("pointerdown", listener));
    }
    const focusTarget = this.options.container;
    if (focusTarget &&
      typeof focusTarget.addEventListener === "function" &&
      (this.options.interactions?.keyboard || this.options.interactions?.clipboard)) {
      const listener: EventListener = () => { focusedBoard = this; };
      focusTarget.addEventListener("focusin", listener);
      this.cleanup.add(() => focusTarget.removeEventListener("focusin", listener));
      if (typeof HTMLElement !== "undefined" &&
        focusTarget instanceof HTMLElement &&
        !focusTarget.hasAttribute("tabindex")) {
        focusTarget.tabIndex = -1;
        this.cleanup.add(() => focusTarget.removeAttribute("tabindex"));
      }
    }
    const container = this.options.container;
    const createObserver = this.options.ports?.createResizeObserver;
    if (container && createObserver) {
      const observer = createObserver((entries) => {
        if (this.signal.aborted) return;
        const rect = entries[0]?.contentRect;
        if (rect?.width && rect?.height) {
          this.core.viewport.setScreenSize({ width: rect.width, height: rect.height });
          // setScreenSize does not raise viewport:change (the projection is
          // unchanged, only the surface it covers), so the culling rectangle
          // has to be recomputed here as well.
          this.queueVisibleBoundsSync();
        }
      });
      observer.observe(container);
      this.cleanup.add(() => observer.disconnect());
    }
    const ticker = this.options.ports?.ticker;
    if (ticker) {
      const listener = () => undefined;
      ticker.add(listener);
      this.cleanup.add(() => ticker.remove(listener));
    }
  }

  /**
   * Pushes the current visible rectangle to the renderer. Runs inside the
   * runtime queue so it can never interleave with an in-flight apply/rebuild,
   * which would leave the renderer culling against one revision while
   * reconciling another.
   */
  private async syncVisibleBounds(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer?.setVisibleBounds || this.signal.aborted) return;
    const virtualization = this.options.virtualization;
    if (virtualization?.enabled === false) {
      await renderer.setVisibleBounds(undefined);
      return;
    }
    const padding = virtualization?.padding ?? DEFAULT_VIRTUALIZATION_PADDING;
    const bounds = this.core.viewport.visibleWorldBounds(padding);
    await renderer.setVisibleBounds(bounds, this.core.viewport.get().scale);
  }

  private queueVisibleBoundsSync(): void {
    if (this.signal.aborted || !this.renderer?.setVisibleBounds) return;
    this.pendingRuntimeWork = this.pendingRuntimeWork
      .then(async () => {
        await this.syncVisibleBounds();
        if (this.signal.aborted) return;
        // ResizeObserver-driven culling changes do not produce a core
        // viewport event. Notify consumers after the renderer has reconciled
        // so visible-set-backed overlays can invalidate their candidate cache.
        this.events.emit("render:complete", {
          revision: this.renderedRevision,
          frameId: ++this.frameId,
        });
      })
      .catch((error) => {
        if (!this.signal.aborted) queueMicrotask(() => { throw error; });
      });
  }

  private queueChange(event: BoardChangeEvent): void {
    this.pendingRuntimeWork = this.pendingRuntimeWork.then(async () => {
      if (this.signal.aborted) return;
      // Initial persistence hydration is rendered by mount().rebuild() after the
      // runtime is initialized; do not race that path with an incremental apply.
      if (this.lifecycle === "mounting" && event.changeSet.origin === "load") return;
      if (this.renderer) {
        try {
          const result = await waitForAbort(this.renderer.apply(event.documentUpdate, event.changeSet), this.signal);
          if (result === "rebuild-required" && !this.signal.aborted) {
            await waitForAbort(this.renderer.rebuild(this.core.document.snapshot()), this.signal);
          }
        } catch (error) {
          if (!this.signal.aborted) {
            await waitForAbort(this.renderer.rebuild(this.core.document.snapshot()), this.signal);
          }
          throw error;
        }
        if (this.signal.aborted) return;
        this.renderedRevision = event.revision;
        this.events.emit("render:complete", {
          revision: event.revision,
          frameId: ++this.frameId,
        });
      }
      if (this.signal.aborted) return;
      const persistence = this.options.persistence;
      if (persistence?.save) {
        await waitForAbort(persistence.save(this.core.document.toJSON(), { signal: this.signal }), this.signal);
      }
      if (this.signal.aborted) return;
      this.events.emit("change", event);
      if (event.changeSet.assetChangedNodeIds.length) this.events.emit("assets:change", event);
      for (const nodeId of [
        ...event.changeSet.addedNodeIds,
        ...event.changeSet.updatedNodeIds,
        ...event.changeSet.removedNodeIds,
      ]) {
        this.nodeEvents.emit(`${nodeId}:change`, event);
      }
    }).catch((error) => {
      if (!this.signal.aborted) queueMicrotask(() => { throw error; });
    });
  }

  private async performDestroy(): Promise<void> {
    if (this.lifecycle === "destroyed") return;
    this.lifecycle = "destroying";
    // Ends any live gesture before assertAlive() starts rejecting its writes.
    this.transformController.dispose();
    if (focusedBoard === this) focusedBoard = undefined;
    this.abortController.abort(new BoardDestroyedError());
    for (const dispose of this.cleanup) dispose();
    this.cleanup.clear();
    await this.renderer?.destroy();
    await this.pendingRuntimeWork.catch(() => undefined);
    await this.options.persistence?.destroy?.();
    this.events.clear();
    this.nodeEvents.clear();
    this.lifecycle = "destroyed";
  }

  private assertAlive(): void {
    if (this.lifecycle === "destroying" || this.lifecycle === "destroyed") {
      throw new BoardDestroyedError();
    }
  }
}

export async function createPixiBoard(options: PixiBoardOptions = {}): Promise<PixiBoard> {
  return new PixiBoardFacade(options);
}

function mergeSignals(instanceSignal: AbortSignal, externalSignal?: AbortSignal): AbortSignal {
  if (!externalSignal) return instanceSignal;
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => controller.abort(signal.reason);
  if (instanceSignal.aborted) abort(instanceSignal);
  else instanceSignal.addEventListener("abort", () => abort(instanceSignal), { once: true });
  if (externalSignal.aborted) abort(externalSignal);
  else externalSignal.addEventListener("abort", () => abort(externalSignal), { once: true });
  return controller.signal;
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.resolve(undefined);
  }
  const aborted = new Promise<undefined>((resolve) => {
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });
  void operation.catch(() => undefined);
  return Promise.race([operation, aborted]);
}

function scopeCapabilities(
  capabilities: BoardCapabilities,
  instanceSignal: AbortSignal,
  assertAlive: () => void,
): BoardCapabilities {
  const options = <Options extends { signal?: AbortSignal } | undefined>(value: Options) => ({
    ...(value ?? {}),
    signal: mergeSignals(instanceSignal, value?.signal),
  });
  return {
    availability: capabilities.availability,
    document: {
      snapshot: (value) => { assertAlive(); return capabilities.document.snapshot(options(value)); },
      load: (input, value) => { assertAlive(); return capabilities.document.load(input, options(value)); },
      validate: (input, value) => { assertAlive(); return capabilities.document.validate(input, options(value)); },
    },
    nodes: {
      read: (input, value) => { assertAlive(); return capabilities.nodes.read(input, options(value)); },
      create: (input, value) => { assertAlive(); return capabilities.nodes.create(input, options(value)); },
      update: (input, value) => { assertAlive(); return capabilities.nodes.update(input, options(value)); },
      delete: (input, value) => { assertAlive(); return capabilities.nodes.delete(input, options(value)); },
    },
    assets: {
      read: (input, value) => { assertAlive(); return capabilities.assets.read(input, options(value)); },
      upsert: (input, value) => { assertAlive(); return capabilities.assets.upsert(input, options(value)); },
      remove: (input, value) => { assertAlive(); return capabilities.assets.remove(input, options(value)); },
    },
    selection: {
      get: (value) => { assertAlive(); return capabilities.selection.get(options(value)); },
      set: (nodeIds, value) => { assertAlive(); return capabilities.selection.set(nodeIds, options(value)); },
    },
    viewport: {
      get: (value) => { assertAlive(); return capabilities.viewport.get(options(value)); },
      set: (viewport, value) => { assertAlive(); return capabilities.viewport.set(viewport, options(value)); },
    },
    history: {
      canUndo: () => { assertAlive(); return capabilities.history.canUndo(); },
      canRedo: () => { assertAlive(); return capabilities.history.canRedo(); },
      clear: () => { assertAlive(); capabilities.history.clear(); },
      undo: (value) => { assertAlive(); return capabilities.history.undo(options(value)); },
      redo: (value) => { assertAlive(); return capabilities.history.redo(options(value)); },
    },
    preview: {
      get: (input, value) => { assertAlive(); return capabilities.preview.get(input, options(value)); },
    },
    capture: {
      available: capabilities.capture.available,
      capture: (input, value) => { assertAlive(); return capabilities.capture.capture(input, options(value)); },
    },
  };
}
