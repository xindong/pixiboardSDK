import { describe, expect, it, vi } from "vitest";
import { NodeTypeRegistry, type BoardDocument, type BoardNode } from "@pixi-board/core";
import { createPixiApplicationFactory, NodeRendererRegistry, PixiBoardRenderer, createPixiViewFactory } from "../src/index";
import { registerTaskCardRenderer, taskCardNode } from "./fixtures";

const node = (id: string, type = "rect", x = 0): BoardNode => ({ id, type, typeVersion: 1, x, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0, props: {} });
const doc = (nodes: BoardNode[], revision = 0): BoardDocument => ({ schemaVersion: 1, revision, nodes, assets: [] });
const update = (changedNodes: BoardNode[], revision: number) => ({ revision, changedNodes });
function fake() {
  const stage: any = { children: [], addChild(child: any) { this.children.push(child); }, removeChild(child: any) { this.children = this.children.filter((x: any) => x !== child); } };
  const app: any = { stage, init: vi.fn(async () => {}), destroy: vi.fn(), render: vi.fn(), ticker: { add: vi.fn(), remove: vi.fn(), start: vi.fn(), stop: vi.fn() } };
  const factory: any = { createContainer: () => ({ children: [], addChild(child: any) { this.children.push(child); }, removeChild(child: any) { this.children = this.children.filter((x: any) => x !== child); }, destroy: vi.fn() }), createRect: () => ({ destroy: vi.fn() }), createText: (text: string) => ({ text, destroy: vi.fn() }) };
  return { app, factory };
}

describe("renderer-pixi vertical slice", () => {
  it("registers custom renderers and applies incremental ChangeSets", async () => {
    const { app, factory } = fake(); const registry = new NodeRendererRegistry(); const calls: string[] = [];
    registry.register("custom", { create: () => { calls.push("create"); return { displayObject: factory.createContainer(), state: {} }; }, update: () => { calls.push("update"); }, destroy: () => { calls.push("destroy"); } });
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry }); await renderer.init();
    await renderer.rebuild(doc([node("a", "custom")], 1)); expect(renderer.activeViews.has("a")).toBe(true);
    await renderer.apply(update([node("a", "custom", 5), node("b")], 2), { revision: 2, transactionId: "t", origin: "api", addedNodeIds: ["b"], updatedNodeIds: ["a"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
    expect(renderer.activeViews.size).toBe(2); expect(calls).toContain("update"); await renderer.destroy(); expect(renderer.activeViews.size).toBe(0); expect(calls).toContain("destroy");
  });
  it("uses unknown placeholder and cleans late async create after destroy", async () => {
    const { app, factory } = fake(); const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory }); await renderer.init();
    let resolve!: (v: any) => void; const pending = new Promise<any>((r) => { resolve = r; });
    renderer.registry.register("slow", { create: async () => pending, update: () => {}, destroy: vi.fn() });
    const work = renderer.rebuild(doc([node("u", "mystery"), node("s", "slow")], 1)); await Promise.resolve(); await renderer.destroy(); resolve({ displayObject: factory.createContainer(), state: {} }); await work;
    expect(renderer.activeViews.size).toBe(0); expect(renderer.diagnostics.lateUpdates).toBeGreaterThan(0);
  });
  it("supports injected bounds culling", async () => {
    const { app, factory } = fake(); const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, cullingQuery: () => ["a"] }); await renderer.init(); await renderer.rebuild(doc([node("a"), node("b", "rect", 100)], 1));
    await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: 20, maxY: 20 }); expect(renderer.activeViews.has("a")).toBe(true); expect(renderer.activeViews.has("b")).toBe(false); await renderer.destroy();
  });
  it("reconciles offscreen snapshots when the viewport moves", async () => {
    const { app, factory } = fake(); const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, cullingQuery: () => [] }); await renderer.init();
    await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: 20, maxY: 20 }); await renderer.rebuild(doc([node("a"), node("b", "rect", 100)], 1)); expect(renderer.activeViews.size).toBe(0);
    renderer.setCullingQuery(() => ["b"]); await renderer.setVisibleBounds({ minX: 90, minY: 0, maxX: 120, maxY: 30 }); expect(renderer.activeViews.has("b")).toBe(true);
    renderer.setCullingQuery(() => ["a"]); await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: 20, maxY: 20 }); expect(renderer.activeViews.has("a")).toBe(true); expect(renderer.activeViews.has("b")).toBe(false); await renderer.destroy();
  });
  it("preserves custom builtins, releases image leases, and hit-tests by z order", async () => {
    const { app, factory } = fake(); const registry = new NodeRendererRegistry(); const release = vi.fn(); const custom = { create: () => ({ displayObject: factory.createContainer(), state: {} }), update: vi.fn(), destroy: vi.fn() }; registry.register("rect", custom as any);
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry, acquireTexture: async () => ({ texture: {}, release }) }); await renderer.init(); expect(renderer.registry.get("rect")).toBe(custom);
    await renderer.rebuild(doc([{ ...node("low", "rect"), zIndex: 3 }, { ...node("same-later", "rect"), zIndex: 3 }, { ...node("img", "image", 0), zIndex: 2, assetRefs: { image: { assetId: "a" } } }], 1)); expect(renderer.hitTest({ x: 1, y: 1 })).toBe("same-later");
    await renderer.destroy(); expect(release).toHaveBeenCalledTimes(1);
  });
  it("exposes a lazy default PixiJS application factory without starting WebGL", () => {
    const initOptions = { preference: "webgpu", antialias: true };
    class FakeApplication { stage = {}; init = vi.fn(); destroy = vi.fn(); }
    const factory = createPixiApplicationFactory(initOptions, async () => ({ Application: FakeApplication, Container: class {}, Graphics: class {}, Sprite: class {}, Text: class {} } as any));
    expect(typeof factory).toBe("function");
    return factory().then((created) => {
      expect(created).toBeInstanceOf(FakeApplication);
      // autoStart/sharedTicker default to false (on-demand rendering); the
      // caller's own initOptions still win if it sets them explicitly.
      expect(created.initOptions).toEqual({ ...initOptions, autoStart: false, sharedTicker: false });
      expect(typeof created.init).toBe("function");
      created.init?.({ probe: true });
      expect((created.init as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ probe: true });
    });
  });
  it("creates image sprites without treating asset ids as URLs", () => {
    const sprite = { kind: "sprite" };
    const viewFactory = createPixiViewFactory({ Application: class {} as any, Container: class {} as any, Graphics: class {} as any, Sprite: class { constructor() { return sprite as any; } } as any, Text: class {} as any });
    expect(viewFactory.createImage?.({ assetId: "asset-id" }, node("image", "image"))).toBe(sprite);
    const renderer = new PixiBoardRenderer({});
    expect(renderer.registry.has("rect")).toBe(true);
  });
  it("uses the real spatial index for bounds culling and updates it from the document", async () => {
    const { app, factory } = fake(); const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory }); await renderer.init();
    await renderer.setVisibleBounds({ minX: -1, minY: -1, maxX: 20, maxY: 20 }); await renderer.rebuild(doc([node("near"), node("far", "rect", 1000)], 1));
    expect(renderer.activeViews.has("near")).toBe(true); expect(renderer.activeViews.has("far")).toBe(false);
    await renderer.apply(update([{ ...node("far", "rect", 5) }], 2), { revision: 2, transactionId: "t", origin: "api", addedNodeIds: [], updatedNodeIds: ["far"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
    expect(renderer.activeViews.has("far")).toBe(true); await renderer.destroy();
  });
  it("captures viewport, bounds, and node through an injectable contract without changing the active scene", async () => {
    const { app, factory } = fake(); const requests: any[] = []; const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, capture: (frame, request, signal) => { requests.push({ frame, request, signal }); return { dataUrl: "data:image/png;base64,ok", mimeType: "image/png", width: 10, height: 20 }; } }); await renderer.init(); await renderer.rebuild(doc([node("a")], 7));
    const before = [...renderer.activeViews.keys()]; const viewport = await renderer.capture({ target: "viewport", scale: 2 }, { requestId: "r1" }); const bounds = await renderer.capture({ target: "bounds", bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 } }); const single = await renderer.capture({ target: "node", nodeId: "a" });
    expect(viewport).toMatchObject({ mimeType: "image/png", revision: 7, requestId: "r1" }); expect(bounds.dataUrl).toContain("data:image/png"); expect(single.width).toBe(10); expect(requests).toHaveLength(3); expect([...renderer.activeViews.keys()]).toEqual(before); await renderer.destroy();
  });
  it("rehydrates a custom task-card from document props and destroys/recreates its cached view", async () => {
    const { app, factory } = fake(); const registry = new NodeRendererRegistry(); registerTaskCardRenderer(registry, factory); const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry }); await renderer.init();
    await renderer.rebuild(doc([taskCardNode("task", "Draft")], 1)); expect((renderer.activeViews.get("task") as any).state.title).toBe("Draft");
    await renderer.setVisibleBounds({ minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 }); expect(renderer.activeViews.has("task")).toBe(false);
    await renderer.setVisibleBounds(undefined); await renderer.rebuild(doc([taskCardNode("task", "Saved")], 2)); expect((renderer.activeViews.get("task") as any).state.title).toBe("Saved"); await renderer.destroy();
  });
  it("updates only touched nodes and deletes removed views incrementally", async () => {
    const { app, factory } = fake(); const registry = new NodeRendererRegistry(); const updates = new Map<string, number>(); const destroys: string[] = [];
    registry.register("tracked", {
      create: (item) => ({ displayObject: factory.createContainer(), state: { id: item.id } }),
      update: (_view, item) => updates.set(item.id, (updates.get(item.id) ?? 0) + 1),
      destroy: (view) => destroys.push((view.state as any).id),
    });
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry }); await renderer.init();
    await renderer.rebuild(doc([node("a", "tracked"), node("b", "tracked")], 1));
    expect(Object.fromEntries(updates)).toEqual({ a: 1, b: 1 });
    await renderer.apply(update([{ ...node("a", "tracked"), x: 20 }], 2), { revision: 2, transactionId: "incremental", origin: "api", addedNodeIds: [], updatedNodeIds: ["a"], removedNodeIds: ["b"], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
    expect(Object.fromEntries(updates)).toEqual({ a: 2, b: 1 });
    expect(destroys).toContain("b");
    expect([...renderer.activeViews.keys()]).toEqual(["a"]);
    await renderer.destroy();
  });
  it("applies one changed node in a 100k document without iterating the document cache", async () => {
    const { app, factory } = fake();
    const nodes = Array.from({ length: 100_000 }, (_, index) => ({
      ...node(`node-${index}`, "rect", index),
      ...(index === 99_999 ? {} : { visible: false }),
    }));
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory });
    await renderer.init();
    await renderer.setVisibleBounds({ minX: -1, minY: -1, maxX: 100_020, maxY: 20 });
    await renderer.rebuild(doc(nodes, 1));

    const nodesById = (renderer as any).nodesById as Map<string, BoardNode>;
    const entries = (renderer as any).entries as Map<string, unknown>;
    const spatialIndex = renderer.spatialIndex;
    const originalNodeKeys = nodesById.keys;
    const originalEntryKeys = entries.keys;
    const originalSpatialQuery = spatialIndex.query;
    nodesById.keys = (() => { throw new Error("incremental apply scanned all cached nodes"); }) as typeof nodesById.keys;
    entries.keys = (() => { throw new Error("incremental apply scanned all active entries"); }) as typeof entries.keys;
    spatialIndex.query = (() => { throw new Error("incremental apply queried the full viewport"); }) as typeof spatialIndex.query;

    const changed = { ...nodes[99_999], x: 42 };
    await renderer.apply(update([changed], 2), { revision: 2, transactionId: "100k", origin: "api", addedNodeIds: [], updatedNodeIds: [changed.id], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
    expect(renderer.diagnostics.updates).toBe(1);
    expect(((renderer as any).entries.get(changed.id).node as BoardNode).x).toBe(42);

    nodesById.keys = originalNodeKeys;
    entries.keys = originalEntryKeys;
    spatialIndex.query = originalSpatialQuery;
    await renderer.destroy();
  }, 30_000);
  it("short-circuits a large custom culling iterable for changed ids", async () => {
    const { app, factory } = fake();
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory });
    await renderer.init();
    await renderer.setVisibleBounds({ minX: -1, minY: -1, maxX: 20, maxY: 20 });
    await renderer.rebuild(doc([node("a"), node("b", "rect", 100)], 1));

    let reads = 0;
    renderer.setCullingQuery(() => ({
      *[Symbol.iterator]() {
        reads += 1;
        yield "b";
        throw new Error("incremental apply exhausted the full culling iterable");
      },
    }));
    await renderer.apply(update([{ ...node("b", "rect", 5) }], 2), {
      revision: 2,
      transactionId: "lazy-culling",
      origin: "api",
      addedNodeIds: [],
      updatedNodeIds: ["b"],
      removedNodeIds: [],
      assetChangedNodeIds: [],
      selectionChanged: false,
      viewportChanged: false,
      timestamp: 1,
    });

    expect(reads).toBe(1);
    expect(renderer.activeViews.has("b")).toBe(true);
    await renderer.destroy();
  });
  it("uses culling membership without touching the candidate iterable", async () => {
    const { app, factory } = fake();
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory });
    await renderer.init();
    await renderer.setVisibleBounds({ minX: -1, minY: -1, maxX: 20, maxY: 20 });
    await renderer.rebuild(doc([node("a"), node("b", "rect", 100)], 1));

    const has = vi.fn((id: string) => id === "b");
    renderer.setCullingQuery(() => ({
      has,
      [Symbol.iterator]: () => { throw new Error("membership path iterated culling candidates"); },
    }));
    await renderer.apply(update([{ ...node("b", "rect", 5) }], 2), {
      revision: 2,
      transactionId: "membership-culling",
      origin: "api",
      addedNodeIds: [],
      updatedNodeIds: ["b"],
      removedNodeIds: [],
      assetChangedNodeIds: [],
      selectionChanged: false,
      viewportChanged: false,
      timestamp: 1,
    });

    expect(has).toHaveBeenCalledWith("b");
    expect(renderer.activeViews.has("b")).toBe(true);
    await renderer.destroy();
  });
  it("rebuilds cached spatial bounds when registered node types change", async () => {
    const { app, factory } = fake();
    const nodeTypes = new NodeTypeRegistry();
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, nodeTypes });
    await renderer.init();
    await renderer.setVisibleBounds({ minX: 100, minY: 0, maxX: 120, maxY: 20 });
    await renderer.rebuild(doc([node("shifted", "shifted")], 1));
    expect(renderer.activeViews.has("shifted")).toBe(false);

    nodeTypes.register({
      type: "shifted",
      version: 1,
      validate: (value) => value as Record<string, never>,
      getBounds: () => ({ minX: 100, minY: 0, maxX: 110, maxY: 10 }),
    });
    await renderer.refreshRegisteredTypes();

    expect(renderer.activeViews.has("shifted")).toBe(true);
    await renderer.destroy();
  });
  it("requires a rebuild after a failed incremental view update", async () => {
    const { app, factory } = fake();
    const registry = new NodeRendererRegistry();
    let updates = 0;
    registry.register("fallible", {
      create: () => ({ displayObject: factory.createContainer(), state: {} }),
      update: () => { if (++updates === 2) throw new Error("update failed"); },
      destroy: () => undefined,
    });
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry });
    await renderer.init();
    await renderer.rebuild(doc([node("fallible", "fallible")], 1));

    await expect(renderer.apply(update([node("fallible", "fallible", 2)], 2), { revision: 2, transactionId: "fail", origin: "api", addedNodeIds: [], updatedNodeIds: ["fallible"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 })).rejects.toThrow("update failed");
    await expect(renderer.apply(update([node("fallible", "fallible", 3)], 3), { revision: 3, transactionId: "gap", origin: "api", addedNodeIds: [], updatedNodeIds: ["fallible"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 })).resolves.toBe("rebuild-required");
    await renderer.rebuild(doc([node("fallible", "fallible", 2)], 2));
    await expect(renderer.apply(update([node("fallible", "fallible", 3)], 3), { revision: 3, transactionId: "recovered", origin: "api", addedNodeIds: [], updatedNodeIds: ["fallible"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 })).resolves.toBe("applied");
    expect(((renderer as any).entries.get("fallible").node as BoardNode).x).toBe(3);
    await renderer.destroy();
  });
  it("reacquires a same-ref preview on asset changes and releases both generations", async () => {
    const { app, factory } = fake(); const releases: string[] = []; let generation = 0;
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, acquireTexture: async () => { const id = `lease-${++generation}`; return { texture: { id }, release: () => releases.push(id) }; } }); await renderer.init();
    const image = { ...node("image", "image"), assetRefs: { preview: { assetId: "preview" } } };
    await renderer.rebuild(doc([image], 1));
    await renderer.apply(update([{ ...image, x: 1 }], 2), { revision: 2, transactionId: "preview", origin: "api", addedNodeIds: [], updatedNodeIds: ["image"], removedNodeIds: [], assetChangedNodeIds: ["image"], selectionChanged: false, viewportChanged: false, timestamp: 1 });
    expect(generation).toBe(2);
    expect(releases).toEqual(["lease-1"]);
    expect(renderer.diagnostics.textureLeases).toBe(1);
    await renderer.destroy();
    expect(releases).toEqual(["lease-1", "lease-2"]);
    expect(renderer.diagnostics.textureLeases).toBe(0);
  });
  it("prevents a late texture generation from replacing a newer asset refresh", async () => {
    const { app, factory } = fake(); const releases: string[] = []; const resolvers: Array<(lease: any) => void> = [];
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, acquireTexture: () => new Promise((resolve) => resolvers.push(resolve)) }); await renderer.init();
    const image = { ...node("race", "image"), assetRefs: { preview: { assetId: "same-ref" } } };
    const first = renderer.rebuild(doc([image], 1)); await Promise.resolve();
    const second = renderer.apply(update([{ ...image, x: 2 }], 2), { revision: 2, transactionId: "race", origin: "api", addedNodeIds: [], updatedNodeIds: ["race"], removedNodeIds: [], assetChangedNodeIds: ["race"], selectionChanged: false, viewportChanged: false, timestamp: 1 }); await Promise.resolve();
    expect(resolvers).toHaveLength(2);
    resolvers[1]({ texture: { generation: 2 }, release: () => releases.push("new") }); await second;
    resolvers[0]({ texture: { generation: 1 }, release: () => releases.push("old") }); await first;
    expect((renderer.activeViews.get("race")?.displayObject.texture as any).generation).toBe(2);
    expect(releases).toContain("old");
    await renderer.destroy();
    expect(releases).toContain("new");
  });
  it("returns managed listener, ticker, view, and texture counts to baseline", async () => {
    const { app, factory } = fake(); const listeners = new Set<EventListenerOrEventListenerObject>(); const target = { addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener), removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener) }; const tickers = new Set<(...args: unknown[]) => void>(); app.ticker = { add: (listener: (...args: unknown[]) => void) => tickers.add(listener), remove: (listener: (...args: unknown[]) => void) => tickers.delete(listener), start: vi.fn(), stop: vi.fn() };
    const registry = new NodeRendererRegistry(); registry.register("managed", { create: (_item, context) => { context.resources.listen(target, "change", () => {}); context.resources.addTicker(() => {}); return { displayObject: factory.createContainer(), state: {} }; }, update: () => {}, destroy: () => {} });
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry, acquireTexture: async () => ({ texture: {}, release: vi.fn() }) }); await renderer.init();
    await renderer.rebuild(doc([node("managed", "managed"), { ...node("image", "image"), assetRefs: { primary: { assetId: "image" } } }], 1));
    expect(renderer.diagnostics).toMatchObject({ activeViews: 2, listeners: 1, tickers: 1, textureLeases: 1 });
    await renderer.destroy();
    expect(renderer.diagnostics).toMatchObject({ activeViews: 0, pendingOperations: 0, listeners: 0, tickers: 0, textureLeases: 0 });
    expect(listeners.size).toBe(0); expect(tickers.size).toBe(0);
  });
  describe("on-demand rendering", () => {
    it("does not render during init, and starts the Pixi ticker stopped by default", async () => {
      const { app, factory } = fake();
      const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory });
      await renderer.init();
      expect(app.render).not.toHaveBeenCalled();
      expect(app.init).toHaveBeenCalledWith(expect.objectContaining({ autoStart: false, sharedTicker: false }));
      await renderer.destroy();
    });
    it("renders exactly once per rebuild, apply, and setVisibleBounds call", async () => {
      const { app, factory } = fake();
      const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory });
      await renderer.init();

      await renderer.rebuild(doc([node("a"), node("b", "rect", 100)], 1));
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(1));

      await renderer.apply(update([{ ...node("a", "rect", 5) }], 2), { revision: 2, transactionId: "t", origin: "api", addedNodeIds: [], updatedNodeIds: ["a"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(2));

      await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(3));

      await renderer.destroy();
    });
    it("coalesces multiple invalidations within the same microtask into one render", async () => {
      const { app, factory } = fake();
      const registry = new NodeRendererRegistry();
      let invalidate: (() => void) | undefined;
      registry.register("manual", { create: (_item, context) => { invalidate = context.invalidate; return { displayObject: factory.createContainer(), state: {} }; }, update: () => {}, destroy: () => {} });
      const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry });
      await renderer.init();
      await renderer.rebuild(doc([node("a", "manual")], 1));
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(1));
      app.render.mockClear();

      // Two synchronous invalidations in the same tick, before the
      // microtask-scheduled render has a chance to flush, must still only
      // paint once.
      invalidate?.();
      invalidate?.();
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(1));
      await renderer.destroy();
    });
    it("keeps the Pixi ticker running while a custom node renderer holds a ticker subscription, and stops it once released", async () => {
      const { app, factory } = fake();
      const registry = new NodeRendererRegistry();
      let release: (() => void) | undefined;
      registry.register("animated", { create: (_item, context) => { release = context.resources.addTicker(() => {}); return { displayObject: factory.createContainer(), state: {} }; }, update: () => {}, destroy: () => {} });
      const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry });
      await renderer.init();

      await renderer.rebuild(doc([node("a", "animated")], 1));
      expect(app.ticker.start).toHaveBeenCalledTimes(1);
      expect(app.ticker.stop).not.toHaveBeenCalled();

      // While a ticker subscription is active, apply/rebuild must not fall
      // back to a single on-demand app.render() call — Pixi's own ticker is
      // already driving continuous frames for the animation.
      app.render.mockClear();
      await renderer.apply(update([{ ...node("a", "animated", 5) }], 2), { revision: 2, transactionId: "t", origin: "api", addedNodeIds: [], updatedNodeIds: ["a"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.render).not.toHaveBeenCalled();

      release?.();
      expect(app.ticker.stop).toHaveBeenCalledTimes(1);
      await renderer.destroy();
    });
    it("requests a frame when a custom node renderer calls context.invalidate()", async () => {
      const { app, factory } = fake();
      const registry = new NodeRendererRegistry();
      let invalidate: (() => void) | undefined;
      registry.register("manual", { create: (_item, context) => { invalidate = context.invalidate; return { displayObject: factory.createContainer(), state: {} }; }, update: () => {}, destroy: () => {} });
      const onInvalidate = vi.fn();
      const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry, onInvalidate });
      await renderer.init();
      await renderer.rebuild(doc([node("a", "manual")], 1));
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(1));
      app.render.mockClear();

      invalidate?.();
      expect(onInvalidate).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(app.render).toHaveBeenCalledTimes(1));
      await renderer.destroy();
    });
  });
});
