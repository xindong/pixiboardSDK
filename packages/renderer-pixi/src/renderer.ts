import { rotatedRectBounds, type BoardNode, type BoardDocument, type BoardDocumentUpdate, type BoardChangeSet, type WorldBounds, type Point, type AssetRef, type NodeTypeRegistry } from "@pixi-board/core";
import { NodeRendererRegistry } from "./registry";
import { registerBuiltinRenderers } from "./builtins";
import { GridSpatialIndex } from "./spatial";
import type { CaptureAdapter, CaptureRequest, CullingQuery, PixiApplication, PixiApplicationFactory, PixiDisplayObject, PixiNodeRendererContext, PixiNodeView, PixiViewFactory, RendererApplyResult, RendererCaptureResult, RendererDiagnostics, RendererResourceScope, SpatialIndex, TextureLease } from "./types";
import { createPixiApplicationFactory, createPixiViewFactory, loadPixiRuntime } from "./pixi-adapter";

type NodeRenderer = NonNullable<ReturnType<NodeRendererRegistry["get"]>>;
type Entry = { node: Readonly<BoardNode>; view: PixiNodeView; renderer: NodeRenderer; lifetime: AbortController; scope: ResourceScope };
type NodeOperation = { version: number; controller: AbortController; promise?: Promise<void> };

export type PixiBoardRendererOptions = {
  applicationFactory?: PixiApplicationFactory;
  viewFactory?: PixiViewFactory;
  cullingQuery?: CullingQuery;
  spatialIndex?: SpatialIndex;
  capture?: CaptureAdapter;
  acquireTexture?: (ref: AssetRef, options?: Record<string, unknown>) => Promise<TextureLease>;
  onInvalidate?: () => void;
  registry?: NodeRendererRegistry;
  nodeTypes?: NodeTypeRegistry;
};

export class PixiBoardRenderer {
  readonly registry: NodeRendererRegistry;
  readonly diagnostics: RendererDiagnostics = { creates: 0, updates: 0, destroys: 0, lateUpdates: 0, activeViews: 0, pendingOperations: 0, textureLeases: 0, listeners: 0, tickers: 0 };
  readonly activeViews = new Map<string, PixiNodeView>();
  readonly spatialIndex: SpatialIndex;
  private readonly options: PixiBoardRendererOptions;
  private readonly instanceAbort = new AbortController();
  private readonly entries = new Map<string, Entry>();
  private readonly operations = new Map<string, NodeOperation>();
  private app?: PixiApplication;
  private world?: PixiDisplayObject;
  private revision?: number;
  private readonly nodesById = new Map<string, Readonly<BoardNode>>();
  private desiredIds = new Set<string>();
  private visibleBounds?: WorldBounds;
  private viewportEpoch = 0;
  private destroyed = false;
  private viewFactory?: PixiViewFactory;

  constructor(options: PixiBoardRendererOptions) {
    this.options = options;
    this.registry = options.registry ?? new NodeRendererRegistry();
    this.spatialIndex = options.spatialIndex ?? new GridSpatialIndex();
    registerBuiltinRenderers(this.registry);
  }

  async init(): Promise<void> {
    if (this.destroyed) throw new Error("Renderer has been destroyed");
    const applicationFactory = this.options.applicationFactory ?? createPixiApplicationFactory();
    this.app = await applicationFactory();
    await this.app.init?.({ preference: "webgl", antialias: false, powerPreference: "high-performance", ...this.app.initOptions });
    const pixi = this.options.viewFactory ? undefined : await loadPixiRuntime();
    this.viewFactory = this.options.viewFactory ?? createPixiViewFactory(pixi!);
    this.world = this.viewFactory.createContainer();
    this.app.stage.addChild?.(this.world);
  }

  async rebuild(snapshot: Readonly<BoardDocument>): Promise<void> {
    this.assertAlive();
    this.revision = snapshot.revision;
    this.nodesById.clear();
    for (const node of snapshot.nodes) this.nodesById.set(node.id, node);
    this.rebuildSpatialIndex(snapshot);
    this.refreshDesiredIds();
    for (const id of new Set([...this.entries.keys(), ...this.operations.keys()])) await this.destroyView(id);
    await this.reconcileActiveSet(++this.viewportEpoch);
  }

  async apply(update: BoardDocumentUpdate, changeSet: BoardChangeSet): Promise<RendererApplyResult> {
    this.assertAlive();
    if (this.revision === undefined || changeSet.revision !== this.revision + 1 || changeSet.revision !== update.revision) {
      return "rebuild-required";
    }

    const touchedIds = new Set([...changeSet.addedNodeIds, ...changeSet.updatedNodeIds, ...changeSet.assetChangedNodeIds]);
    const nextNodes = new Map<string, Readonly<BoardNode>>();
    for (const node of update.changedNodes) if (touchedIds.has(node.id)) nextNodes.set(node.id, node);
    for (const id of touchedIds) {
      if (!nextNodes.has(id)) throw new Error(`Renderer update is missing changed node: ${id}`);
    }
    const addedIds = new Set(changeSet.addedNodeIds);
    const updatedIds = new Set(changeSet.updatedNodeIds);
    const assetChangedIds = new Set(changeSet.assetChangedNodeIds);

    for (const id of changeSet.removedNodeIds) {
      this.nodesById.delete(id);
      this.desiredIds.delete(id);
      this.spatialIndex.remove(id);
      await this.destroyView(id);
    }
    for (const id of touchedIds) {
      const node = nextNodes.get(id);
      if (!node) continue;
      this.nodesById.set(id, node);
      const item = { ...this.getBounds(node), id };
      if (addedIds.has(id)) this.spatialIndex.insert(item);
      else if (updatedIds.has(id)) this.spatialIndex.update(item);
    }

    const customVisibleCandidates = this.visibleBounds && this.options.cullingQuery
      ? new Set(this.options.cullingQuery(this.visibleBounds))
      : undefined;
    for (const id of touchedIds) {
      const node = this.nodesById.get(id);
      const desired = Boolean(node && this.isNodeDesired(node, customVisibleCandidates));
      if (desired) this.desiredIds.add(id);
      else this.desiredIds.delete(id);
      if (!node || !desired) {
        await this.destroyView(id);
        continue;
      }
      await this.ensureView(node, assetChangedIds.has(id));
    }
    this.revision = update.revision;
    return "applied";
  }

  async setVisibleBounds(bounds: WorldBounds | undefined): Promise<void> {
    this.assertAlive();
    this.visibleBounds = bounds;
    this.refreshDesiredIds();
    const epoch = ++this.viewportEpoch;
    await this.reconcileActiveSet(epoch);
  }

  setCullingQuery(query: CullingQuery | undefined): void { this.options.cullingQuery = query; }

  async refreshRegisteredTypes(): Promise<void> {
    this.assertAlive();
    this.rebuildSpatialIndexFromCache();
    this.refreshDesiredIds();
    for (const id of new Set([...this.entries.keys(), ...this.operations.keys()])) await this.destroyView(id);
    await this.reconcileActiveSet(++this.viewportEpoch);
  }

  getBounds(node: Readonly<BoardNode>): WorldBounds {
    const definition = this.options.nodeTypes?.get(node.type);
    return definition ? definition.getBounds(node as BoardNode<any>) : rotatedRectBounds(node);
  }

  hitTest(worldPoint: Point): string | undefined {
    const ids = this.spatialIndex.queryPoint?.(worldPoint) ?? this.entries.keys();
    const order = [...ids]
      .map((id, index) => ({ node: this.entries.get(id)?.node, index }))
      .filter(({ node }) => node)
      .sort((a, b) => b.node!.zIndex - a.node!.zIndex || b.index - a.index);
    for (const { node } of order) {
      const entry = this.entries.get(node!.id)!;
      if (entry.renderer.hitTest?.(node!, worldPoint) ?? contains(this.getBounds(node!), worldPoint)) return node!.id;
    }
    return undefined;
  }

  async capture(request: CaptureRequest, options: { signal?: AbortSignal; requestId?: string } = {}): Promise<RendererCaptureResult> {
    this.assertAlive();
    const signal = combineSignals(this.instanceAbort.signal, options.signal);
    if (signal.aborted) throw abortError();
    const scale = request.scale ?? 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("Capture scale must be positive");
    let target = this.world!;
    let frame: WorldBounds | undefined;
    if (request.target === "node") {
      const node = this.nodesById.get(request.nodeId);
      if (!node) throw new Error(`Node ${request.nodeId} does not exist`);
      const temporary = !this.entries.has(node.id);
      if (temporary) await this.ensureView(node);
      const entry = this.entries.get(node.id);
      if (!entry) throw new Error(`Node ${request.nodeId} is not available for capture`);
      target = entry.view.displayObject;
      frame = { minX: 0, minY: 0, maxX: node.width, maxY: node.height };
      try { return await this.captureFrame(target, frame, scale, request, signal, options.requestId); }
      finally { if (temporary) await this.destroyView(node.id); }
    }
    if (request.target === "bounds") frame = request.bounds;
    if (request.target === "viewport" && this.app?.screen) frame = { minX: 0, minY: 0, maxX: this.app.screen.width, maxY: this.app.screen.height };
    return this.captureFrame(target, frame, scale, request, signal, options.requestId);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.instanceAbort.abort();
    for (const operation of this.operations.values()) operation.controller.abort();
    await Promise.allSettled([...this.operations.values()].map((operation) => operation.promise).filter(Boolean) as Promise<void>[]);
    for (const id of [...this.entries.keys()]) await this.destroyView(id);
    this.world?.destroy?.({ children: true });
    this.app?.destroy?.(true);
    this.entries.clear();
    this.operations.clear();
    this.activeViews.clear();
    this.desiredIds.clear();
    this.updateDiagnosticCounts();
  }

  private async ensureView(node: Readonly<BoardNode>, forceRecreate = false): Promise<void> {
    const renderer = this.registry.get(node.type) ?? this.registry.get("unknown-node")!;
    const current = this.entries.get(node.id);
    if (current && !forceRecreate && current.renderer === renderer && sameAssetRefs(current.node.assetRefs, node.assetRefs)) {
      const operation = this.beginOperation(node.id);
      const task = (async () => {
        current.node = node;
        this.diagnostics.updates++;
        await renderer.update(current.view, node, this.context(combineSignals(current.lifetime.signal, operation.controller.signal), current.scope));
        if (!this.isCurrentOperation(node.id, operation) || this.entries.get(node.id) !== current) this.diagnostics.lateUpdates++;
      })();
      await this.trackOperation(node.id, operation, task);
      return;
    }

    if (current || forceRecreate) await this.destroyView(node.id);
    const operation = this.beginOperation(node.id);
    const lifetime = new AbortController();
    const scope = new ResourceScope(this);
    const signal = combineSignals(this.instanceAbort.signal, lifetime.signal, operation.controller.signal);
    const task = (async () => {
      let view: PixiNodeView | undefined;
      try {
        view = await renderer.create(node, this.context(signal, scope));
        if (signal.aborted || !this.isCurrentOperation(node.id, operation) || this.nodesById.get(node.id) !== node || !this.desiredIds.has(node.id)) {
          this.diagnostics.lateUpdates++;
          renderer.destroy(view, this.context(signal, scope));
          scope.dispose();
          return;
        }
        await renderer.update(view, node, this.context(signal, scope));
        if (signal.aborted || !this.isCurrentOperation(node.id, operation) || this.nodesById.get(node.id) !== node || !this.desiredIds.has(node.id)) {
          this.diagnostics.lateUpdates++;
          renderer.destroy(view, this.context(signal, scope));
          scope.dispose();
          return;
        }
        const entry: Entry = { node, view, renderer, lifetime, scope };
        this.entries.set(node.id, entry);
        this.activeViews.set(node.id, view);
        this.world?.addChild?.(view.displayObject);
        this.diagnostics.creates++;
        this.updateDiagnosticCounts();
      } catch (error) {
        scope.dispose();
        if (signal.aborted || isAbortError(error)) {
          this.diagnostics.lateUpdates++;
          return;
        }
        throw error;
      }
    })();
    await this.trackOperation(node.id, operation, task);
  }

  private beginOperation(id: string): NodeOperation {
    const previous = this.operations.get(id);
    previous?.controller.abort();
    const operation = { version: (previous?.version ?? 0) + 1, controller: new AbortController() };
    this.operations.set(id, operation);
    this.updateDiagnosticCounts();
    return operation;
  }

  private async trackOperation(id: string, operation: NodeOperation, task: Promise<void>): Promise<void> {
    operation.promise = task;
    try { await task; }
    finally {
      if (this.operations.get(id) === operation) this.operations.delete(id);
      operation.controller.abort();
      this.updateDiagnosticCounts();
    }
  }

  private isCurrentOperation(id: string, operation: NodeOperation): boolean { return this.operations.get(id) === operation; }

  private async destroyView(id: string): Promise<void> {
    const operation = this.operations.get(id);
    operation?.controller.abort();
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.lifetime.abort();
    this.entries.delete(id);
    this.activeViews.delete(id);
    this.world?.removeChild?.(entry.view.displayObject);
    entry.renderer.destroy(entry.view, this.context(entry.lifetime.signal, entry.scope));
    entry.scope.dispose();
    this.diagnostics.destroys++;
    this.updateDiagnosticCounts();
  }

  private async reconcileActiveSet(epoch: number): Promise<void> {
    for (const id of new Set([...this.entries.keys(), ...this.operations.keys()])) {
      if (!this.desiredIds.has(id)) await this.destroyView(id);
    }
    for (const id of this.desiredIds) {
      if (epoch !== this.viewportEpoch || this.destroyed) return;
      const node = this.nodesById.get(id);
      if (node && !this.entries.has(id)) await this.ensureView(node);
    }
  }

  private refreshDesiredIds(): void {
    const candidates = this.visibleBounds
      ? this.options.cullingQuery?.(this.visibleBounds) ?? this.spatialIndex.query(this.visibleBounds)
      : this.nodesById.keys();
    this.desiredIds = new Set([...candidates].filter((id) => this.nodesById.get(id)?.visible !== false));
  }

  private isNodeDesired(node: Readonly<BoardNode>, customVisibleCandidates?: ReadonlySet<string>): boolean {
    if (node.visible === false) return false;
    if (!this.visibleBounds) return true;
    if (customVisibleCandidates) return customVisibleCandidates.has(node.id);
    return intersects(this.getBounds(node), this.visibleBounds);
  }

  private rebuildSpatialIndex(snapshot: Readonly<BoardDocument>): void {
    this.spatialIndex.rebuild(snapshot.nodes.map((node) => ({ ...this.getBounds(node), id: node.id })));
  }

  private rebuildSpatialIndexFromCache(): void {
    const items = [...this.nodesById.values()].map((node) => ({ ...this.getBounds(node), id: node.id }));
    this.spatialIndex.rebuild(items);
  }

  private async captureFrame(target: PixiDisplayObject, frame: WorldBounds | undefined, scale: number, request: CaptureRequest, signal: AbortSignal, requestId?: string): Promise<RendererCaptureResult> {
    if (signal.aborted) throw abortError();
    const value = this.options.capture
      ? await this.options.capture({ target, frame, scale, format: "png" }, request, signal)
      : await this.captureWithPixi(target, frame, scale);
    if (signal.aborted) throw abortError();
    return { ...value, revision: this.revision ?? 0, ...(requestId ? { requestId } : {}) };
  }

  private async captureWithPixi(target: PixiDisplayObject, frame: WorldBounds | undefined, scale: number): Promise<{ dataUrl: string; mimeType: string; width?: number; height?: number }> {
    const extract = this.app?.renderer?.extract?.base64;
    if (!extract) throw new Error("Capture is unavailable without a Pixi extract adapter");
    const rectangle = frame ? pixiRectangle(frame) : undefined;
    const dataUrl = await extract.call(this.app!.renderer!.extract, { target, frame: rectangle, format: "png", resolution: scale });
    return {
      dataUrl,
      mimeType: "image/png",
      ...(rectangle ? { width: Math.round(rectangle.width * scale), height: Math.round(rectangle.height * scale) } : {}),
    };
  }

  private context(signal: AbortSignal, scope: ResourceScope): PixiNodeRendererContext {
    if (!this.viewFactory) throw new Error("Renderer is not initialized");
    return {
      signal,
      assets: { acquireTexture: (ref, options) => this.acquireTexture(scope, signal, ref, options) },
      resources: scope.api,
      invalidate: () => this.options.onInvalidate?.(),
      lod: {},
      diagnostics: this.diagnostics,
      display: this.viewFactory,
    };
  }

  private async acquireTexture(scope: ResourceScope, signal: AbortSignal, ref: AssetRef, options?: Record<string, unknown>): Promise<TextureLease> {
    const lease = await (this.options.acquireTexture ?? (async () => ({})))(ref, { ...options, signal });
    if (signal.aborted) {
      lease.release?.();
      throw abortError();
    }
    let active = true;
    this.diagnostics.textureLeases++;
    const release = () => {
      if (!active) return;
      active = false;
      lease.release?.();
      this.diagnostics.textureLeases--;
    };
    scope.add(release);
    return { ...lease, release };
  }

  private updateDiagnosticCounts(): void {
    this.diagnostics.activeViews = this.activeViews.size;
    this.diagnostics.pendingOperations = this.operations.size;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Renderer has been destroyed");
    if (!this.app) throw new Error("Renderer is not initialized");
  }
}

class ResourceScope {
  private readonly cleanups = new Set<() => void>();
  private disposed = false;
  readonly api: RendererResourceScope;

  constructor(private readonly owner: PixiBoardRenderer) {
    this.api = {
      onCleanup: (cleanup) => this.add(cleanup),
      listen: (target, type, listener, options) => {
        target.addEventListener(type, listener, options);
        this.owner.diagnostics.listeners++;
        return this.add(() => {
          target.removeEventListener(type, listener, options);
          this.owner.diagnostics.listeners--;
        });
      },
      addTicker: (listener) => {
        const ticker = (this.owner as any).app?.ticker;
        ticker?.add?.(listener);
        this.owner.diagnostics.tickers++;
        return this.add(() => {
          ticker?.remove?.(listener);
          this.owner.diagnostics.tickers--;
        });
      },
    };
  }

  add(cleanup: () => void): () => void {
    if (this.disposed) { cleanup(); return () => {}; }
    let active = true;
    const wrapped = () => {
      if (!active) return;
      active = false;
      this.cleanups.delete(wrapped);
      cleanup();
    };
    this.cleanups.add(wrapped);
    return wrapped;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of [...this.cleanups].reverse()) cleanup();
    this.cleanups.clear();
  }
}

function contains(bounds: WorldBounds, point: Point): boolean { return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY; }
function intersects(left: WorldBounds, right: WorldBounds): boolean { return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY; }
function sameAssetRefs(a: BoardNode["assetRefs"], b: BoardNode["assetRefs"]): boolean { return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {}); }
function abortError(): DOMException { return new DOMException("Aborted", "AbortError"); }
function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }
function pixiRectangle(frame: WorldBounds): { x: number; y: number; width: number; height: number; copyTo<T extends { x: number; y: number; width: number; height: number }>(target: T): T } {
  const rectangle = {
    x: frame.minX,
    y: frame.minY,
    width: frame.maxX - frame.minX,
    height: frame.maxY - frame.minY,
    copyTo<T extends { x: number; y: number; width: number; height: number }>(target: T): T {
      target.x = rectangle.x;
      target.y = rectangle.y;
      target.width = rectangle.width;
      target.height = rectangle.height;
      return target;
    },
  };
  return rectangle;
}
function combineSignals(...values: Array<AbortSignal | undefined>): AbortSignal {
  const signals = values.filter(Boolean) as AbortSignal[];
  const any = (AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(signals);
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}
