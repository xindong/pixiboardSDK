import { describe, expect, it, vi } from "vitest";
import type { BoardDocument, BoardNode } from "@pixi-board/core";
import { createPixiApplicationFactory, NodeRendererRegistry, PixiBoardRenderer, createPixiViewFactory } from "../src/index";

const node = (id: string, type = "rect", x = 0): BoardNode => ({ id, type, typeVersion: 1, x, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0, props: {} });
const doc = (nodes: BoardNode[], revision = 0): BoardDocument => ({ schemaVersion: 1, revision, nodes, assets: [] });
function fake() {
  const stage: any = { children: [], addChild(child: any) { this.children.push(child); }, removeChild(child: any) { this.children = this.children.filter((x: any) => x !== child); } };
  const app: any = { stage, init: vi.fn(async () => {}), destroy: vi.fn() };
  const factory: any = { createContainer: () => ({ children: [], addChild(child: any) { this.children.push(child); }, removeChild(child: any) { this.children = this.children.filter((x: any) => x !== child); }, destroy: vi.fn() }), createRect: () => ({ destroy: vi.fn() }), createText: (text: string) => ({ text, destroy: vi.fn() }) };
  return { app, factory };
}

describe("renderer-pixi vertical slice", () => {
  it("registers custom renderers and applies incremental ChangeSets", async () => {
    const { app, factory } = fake(); const registry = new NodeRendererRegistry(); const calls: string[] = [];
    registry.register("custom", { create: () => { calls.push("create"); return { displayObject: factory.createContainer(), state: {} }; }, update: () => { calls.push("update"); }, destroy: () => { calls.push("destroy"); } });
    const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory: factory, registry }); await renderer.init();
    await renderer.rebuild(doc([node("a", "custom")], 1)); expect(renderer.activeViews.has("a")).toBe(true);
    await renderer.apply(doc([node("a", "custom", 5), node("b")], 2), { revision: 2, transactionId: "t", origin: "api", addedNodeIds: ["b"], updatedNodeIds: ["a"], removedNodeIds: [], assetChangedNodeIds: [], selectionChanged: false, viewportChanged: false, timestamp: 1 });
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
    const app = { stage: {}, init: vi.fn(), destroy: vi.fn() };
    const factory = createPixiApplicationFactory(initOptions, async () => ({ Application: class { constructor() { return app as any; } }, Container: class {}, Graphics: class {}, Sprite: class {}, Text: class {} } as any));
    expect(typeof factory).toBe("function");
    return factory().then((created) => expect(created.initOptions).toEqual(initOptions));
  });
  it("creates image sprites without treating asset ids as URLs", () => {
    const sprite = { kind: "sprite" };
    const viewFactory = createPixiViewFactory({ Application: class {} as any, Container: class {} as any, Graphics: class {} as any, Sprite: class { constructor() { return sprite as any; } } as any, Text: class {} as any });
    expect(viewFactory.createImage?.({ assetId: "asset-id" }, node("image", "image"))).toBe(sprite);
    const renderer = new PixiBoardRenderer({});
    expect(renderer.registry.has("rect")).toBe(true);
  });
});
