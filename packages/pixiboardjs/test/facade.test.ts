import { describe, expect, it, vi } from "vitest";
import { NodeTypeRegistry, rotatedRectBounds, type NodeTypeDefinition } from "@pixi-board/core";
import {
  BoardDestroyedError,
  CapabilityUnavailableError,
  createPixiBoard,
  type BrowserEventPort,
  type CustomNodeDefinition,
  type RuntimeRenderer,
} from "../src/index";

type CardProps = { title: string };

const cardType: NodeTypeDefinition<CardProps> = {
  type: "card",
  version: 1,
  defaults: { title: "" },
  validate(value): CardProps {
    if (!value || typeof value !== "object" || typeof (value as CardProps).title !== "string") {
      throw new Error("invalid card");
    }
    return value as CardProps;
  },
  getBounds: rotatedRectBounds,
};

function registry(): NodeTypeRegistry {
  const value = new NodeTypeRegistry();
  value.register(cardType);
  return value;
}

function options() {
  let id = 0;
  return {
    headless: true,
    core: { nodeTypes: registry(), idFactory: () => `id-${++id}`, now: () => 1 },
  } as const;
}

function card(id: string) {
  return {
    id,
    type: "card",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    props: { title: id },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class Events implements BrowserEventPort {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }
}

describe("pixiboardjs facade contract", () => {
  it("creates a ready headless runtime and exposes no capture when unavailable", async () => {
    const board = await createPixiBoard(options());
    await board.ready;

    expect(board.state).toBe("ready");
    await expect(board.capture({ target: "viewport" })).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );

    await board.destroy();
    expect(board.state).toBe("destroyed");
    expect(() => board.document.snapshot()).toThrow(BoardDestroyedError);
  });

  it("loads only the current persistence document format", async () => {
    const current = {
      schemaVersion: 1,
      revision: 4,
      nodes: [],
      assets: [],
    };
    const board = await createPixiBoard({
      ...options(),
      persistence: { load: async () => current },
    });
    await board.ready;
    expect(board.document.toJSON()).toEqual(current);
    await board.destroy();

    const legacy = await createPixiBoard({
      ...options(),
      persistence: {
        load: async () => ({ schemaVersion: 0, revision: 0, nodes: [], assets: [] }),
      },
    });
    await expect(legacy.ready).rejects.toThrow("Document schema 0 is older than supported schema 1");
    await legacy.destroy();
  });

  it("keeps NodeHandle snapshots immutable and combines setter work into one transaction", async () => {
    const board = await createPixiBoard(options());
    await board.ready;
    const handle = await board.nodes.create<CardProps>(card("a"));
    await flush();
    const before = board.document.snapshot().revision;
    const changes: number[] = [];
    board.on("change", (event) => changes.push(event.revision));

    board.transaction("Arrange", () => {
      handle.x(40);
      handle.setAttrs({ y: 50, width: 200 });
    });
    await flush();

    expect(handle.getAttrs()).toMatchObject({ x: 40, y: 50, width: 200 });
    expect(Object.isFrozen(handle.getAttrs())).toBe(true);
    expect(board.document.snapshot().revision).toBe(before + 1);
    expect(changes).toEqual([before + 1]);
    expect(board.history.canUndo()).toBe(true);
    board.history.undo();
    expect(handle.getAttrs()).toMatchObject({ x: 0, y: 0, width: 100 });
    await board.destroy();
  });

  it("passes only changed nodes to incremental renderer commits", async () => {
    const apply = vi.fn(async () => "applied" as const);
    const renderer: RuntimeRenderer = {
      init: async () => undefined,
      rebuild: async () => undefined,
      apply,
      destroy: async () => undefined,
    };
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
    });
    await board.ready;

    await board.nodes.create(card("a"));
    await flush();

    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toMatchObject({
      changedNodes: [{ id: "a" }],
    });
    expect(Object.isFrozen(apply.mock.calls[0][0])).toBe(true);
    await board.destroy();
  });

  it("passes the renderer's visible set through, keeping 'unknown' distinct from 'empty'", async () => {
    let visible: ReadonlySet<string> | undefined;
    const renderer: RuntimeRenderer = {
      init: async () => undefined,
      rebuild: async () => undefined,
      apply: async () => "applied" as const,
      visibleNodeIds: () => visible,
      destroy: async () => undefined,
    };
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
    });
    await board.ready;

    // A renderer with no culling information reports undefined, and that has
    // to survive the trip: an overlay reading it as an empty set would hide
    // every item on a renderer that legitimately retains everything.
    expect(board.visibleNodeIds()).toBeUndefined();
    visible = new Set(["id-1"]);
    expect([...board.visibleNodeIds()!]).toEqual(["id-1"]);
    visible = new Set();
    expect(board.visibleNodeIds()?.size).toBe(0);
    await board.destroy();
  });

  it("reports no visible set for a headless board rather than an empty one", async () => {
    const board = await createPixiBoard(options());
    await board.ready;
    await board.nodes.create(card("a"));
    // Headless boards have no renderer at all; "everything is visible" is the
    // only honest answer for a caller deciding what to draw.
    expect(board.visibleNodeIds()).toBeUndefined();
    await board.destroy();
  });

  it("supports lightweight find/findOne queries and exact document.validate signature", async () => {
    const board = await createPixiBoard(options());
    await board.ready;
    const first = await board.nodes.create(card("a"));
    const second = await board.nodes.create({ ...card("b"), type: "card", x: 200 });

    expect(board.find({ type: "card" }).map((node) => node.id)).toEqual([first.id, second.id]);
    expect(board.find({ bounds: { minX: -10, minY: -10, maxX: 120, maxY: 120 } }).map((node) => node.id)).toEqual([first.id]);
    expect(board.findOne(`#${second.id}`)).toMatchObject({ id: second.id, props: { title: "b" } });
    expect(board.findOne("missing")).toBeUndefined();
    expect(board.document.validate(board.document.toJSON())).toEqual(board.document.toJSON());
    await board.destroy();
  });

  it("keeps NodeHandle change subscriptions and transaction event semantics aligned", async () => {
    const board = await createPixiBoard(options());
    await board.ready;
    const handle = await board.nodes.create<CardProps>(card("evented"));
    await flush();
    const order: string[] = [];
    const offBoard = board.on("change", () => order.push("change"));
    const offNode = handle.on("change", () => order.push("node:change"));

    board.transaction("Move evented", () => {
      handle.x(12);
      handle.y(24);
    }, { origin: "api" });
    await flush();

    expect(order).toEqual(["change", "node:change"]);
    expect(board.document.snapshot().revision).toBe(2);
    offNode();
    offBoard();
    board.nodes.update(handle.id, { x: 48 });
    await flush();
    expect(order).toEqual(["change", "node:change"]);
    await board.destroy();
  });

  it("awaits renderer refresh when registering a custom node type after ready", async () => {
    let finishRefresh!: () => void;
    const refreshDone = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const renderer: RuntimeRenderer & { refreshRegisteredTypes(): Promise<void> } = {
      init: async () => undefined,
      rebuild: async () => undefined,
      apply: async () => undefined,
      refreshRegisteredTypes: async () => refreshDone,
      destroy: async () => undefined,
    };
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
    });
    await board.ready;
    const definition: CustomNodeDefinition<CardProps> = {
      ...cardType,
      type: "custom.ready-card",
    };
    let registered = false;
    const registration = board.nodeTypes.register(definition).then(() => { registered = true; });
    await Promise.resolve();
    expect(registered).toBe(false);
    finishRefresh();
    await registration;
    expect(registered).toBe(true);
    expect(board.nodeTypes.has("custom.ready-card")).toBe(true);
    await board.destroy();
  });

  it("rolls back both registries when a ready-time renderer refresh fails", async () => {
    let refreshCount = 0;
    const renderer: RuntimeRenderer = {
      init: async () => undefined,
      rebuild: async () => undefined,
      apply: async () => undefined,
      refreshRegisteredTypes: async () => {
        refreshCount += 1;
        if (refreshCount === 1) throw new Error("refresh failed");
      },
      destroy: async () => undefined,
    };
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
    });
    await board.ready;
    await expect(board.nodeTypes.register({ ...cardType, type: "custom.failed-card" }))
      .rejects.toThrow("refresh failed");
    expect(board.nodeTypes.has("custom.failed-card")).toBe(false);
    expect(refreshCount).toBe(2);
    await board.destroy();
  });

  it("rebuilds from a full snapshot when an incremental renderer reports a revision gap", async () => {
    const rebuild = vi.fn(async () => undefined);
    const renderer: RuntimeRenderer = {
      init: async () => undefined,
      rebuild,
      apply: async () => "rebuild-required",
      destroy: async () => undefined,
    };
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
    });
    await board.ready;

    await board.document.load({ schemaVersion: 1, revision: 7, nodes: [], assets: [] });

    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(rebuild.mock.calls[1][0].revision).toBe(7);
    await board.destroy();
  });

  it("rebuilds immediately after a failed incremental renderer apply", async () => {
    const rebuild = vi.fn(async () => undefined);
    const queuedErrors: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => { queuedErrors.push(callback); });
    const renderer: RuntimeRenderer = {
      init: async () => undefined,
      rebuild,
      apply: async () => { throw new Error("renderer update failed"); },
      destroy: async () => undefined,
    };
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
    });
    await board.ready;

    await board.nodes.create(card("recover"));
    await flush();

    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(rebuild.mock.calls[1][0].nodes.map((node) => node.id)).toEqual(["recover"]);
    expect(queuedErrors).toHaveLength(1);
    vi.unstubAllGlobals();
    await board.destroy();
  });

  it("isolates and releases keyboard and resize listeners for two instances", async () => {
    const firstEvents = new Events();
    const secondEvents = new Events();
    const disconnectFirst = vi.fn();
    const disconnectSecond = vi.fn();
    const firstTicker = { add: vi.fn(), remove: vi.fn() };
    const secondTicker = { add: vi.fn(), remove: vi.fn() };
    const container = {} as Element;
    const first = await createPixiBoard({
      ...options(),
      container,
      interactions: { keyboard: true },
      ports: {
        events: firstEvents,
        ticker: firstTicker,
        createResizeObserver: () => ({ observe: vi.fn(), disconnect: disconnectFirst }),
      },
    });
    const second = await createPixiBoard({
      ...options(),
      container,
      interactions: { keyboard: true },
      ports: {
        events: secondEvents,
        ticker: secondTicker,
        createResizeObserver: () => ({ observe: vi.fn(), disconnect: disconnectSecond }),
      },
    });
    await Promise.all([first.ready, second.ready]);

    expect(firstEvents.listeners.get("keydown")?.size).toBe(1);
    expect(secondEvents.listeners.get("keydown")?.size).toBe(1);
    await first.destroy();
    expect(firstEvents.listeners.get("keydown")?.size).toBe(0);
    expect(secondEvents.listeners.get("keydown")?.size).toBe(1);
    expect(disconnectFirst).toHaveBeenCalledOnce();
    expect(disconnectSecond).not.toHaveBeenCalled();
    expect(firstTicker.add).toHaveBeenCalledOnce();
    expect(firstTicker.remove).toHaveBeenCalledOnce();
    expect(secondTicker.remove).not.toHaveBeenCalled();
    await second.destroy();
    expect(secondEvents.listeners.get("keydown")?.size).toBe(0);
    expect(secondTicker.remove).toHaveBeenCalledOnce();
  });

  it("forwards selection, viewport, history, events, and capture through the facade", async () => {
    const capture = vi.fn(async (_input, requestOptions) => ({
      dataUrl: "data:image/png;base64,AA==",
      mimeType: "image/png",
      aborted: requestOptions.signal?.aborted,
    }));
    const board = await createPixiBoard({ ...options(), capture });
    await board.ready;
    await board.nodes.create(card("a"));
    const selectionEvents = vi.fn();
    const viewportEvents = vi.fn();
    const historyEvents = vi.fn();
    board.on("selection:change", selectionEvents);
    board.on("viewport:change", viewportEvents);
    board.on("history:change", historyEvents);

    board.selection.set(["a"]);
    board.viewport.panBy(20, 10);
    board.nodes.update("a", { x: 5 });
    const result = await board.capture({ target: "viewport", format: "png" });

    expect(board.selection.get()).toEqual(["a"]);
    expect(board.viewport.get().offset).toEqual({ x: 20, y: 10 });
    expect(selectionEvents).toHaveBeenCalledOnce();
    expect(viewportEvents).toHaveBeenCalledOnce();
    expect(historyEvents).toHaveBeenCalled();
    expect(capture).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mimeType: "image/png", aborted: false });
    await board.destroy();
  });

  it("suppresses renderer, persistence, and public late updates after destroy", async () => {
    let releaseApply!: () => void;
    const applyStarted = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const renderer: RuntimeRenderer = {
      init: async () => undefined,
      rebuild: async () => undefined,
      apply: async () => { markStarted(); await applyStarted; return "applied"; },
      destroy: vi.fn(async () => undefined),
    };
    const save = vi.fn(async () => undefined);
    const board = await createPixiBoard({
      ...options(),
      headless: false,
      container: {} as Element,
      rendererFactory: () => renderer,
      persistence: { save },
    });
    await board.ready;
    const changes = vi.fn();
    board.on("change", changes);
    void board.nodes.create(card("late"));
    await started;

    const destroying = board.destroy();
    releaseApply();
    await destroying;

    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
  });

  describe("viewport virtualization", () => {
    function virtualizingRenderer() {
      const setVisibleBounds = vi.fn(async () => undefined);
      const renderer: RuntimeRenderer = {
        init: async () => undefined,
        rebuild: async () => undefined,
        apply: async () => "applied",
        setVisibleBounds,
        destroy: async () => undefined,
      };
      return { renderer, setVisibleBounds };
    }

    it("reports no bounds until a host has measured the surface", async () => {
      const { renderer, setVisibleBounds } = virtualizingRenderer();
      const board = await createPixiBoard({
        ...options(),
        headless: false,
        container: {} as Element,
        rendererFactory: () => renderer,
      });
      await board.ready;

      // An unmeasured surface must not cull: the core's 1x1 default is a
      // placeholder, and passing it through would blank the canvas.
      expect(setVisibleBounds).toHaveBeenCalledWith(undefined, 1);
      await board.destroy();
    });

    it("culls to the measured viewport, padded, and follows pan and zoom", async () => {
      const { renderer, setVisibleBounds } = virtualizingRenderer();
      const board = await createPixiBoard({
        ...options(),
        headless: false,
        container: {} as Element,
        core: { ...options().core, viewportSize: { width: 800, height: 600 } },
        virtualization: { padding: 100 },
        rendererFactory: () => renderer,
      });
      await board.ready;
      expect(setVisibleBounds).toHaveBeenLastCalledWith(
        { minX: -100, minY: -100, maxX: 900, maxY: 700 },
        1,
      );

      board.viewport.panBy(-200, 0);
      await flush();
      expect(setVisibleBounds).toHaveBeenLastCalledWith(
        { minX: 100, minY: -100, maxX: 1100, maxY: 700 },
        1,
      );

      board.viewport.set({ scale: 2, offset: { x: 0, y: 0 } });
      await flush();
      expect(setVisibleBounds).toHaveBeenLastCalledWith(
        { minX: -100, minY: -100, maxX: 500, maxY: 400 },
        2,
      );
      await board.destroy();
    });

    it("retains every node when virtualization is disabled", async () => {
      const { renderer, setVisibleBounds } = virtualizingRenderer();
      const board = await createPixiBoard({
        ...options(),
        headless: false,
        container: {} as Element,
        core: { ...options().core, viewportSize: { width: 800, height: 600 } },
        virtualization: { enabled: false },
        rendererFactory: () => renderer,
      });
      await board.ready;
      board.viewport.panBy(-200, 0);
      await flush();

      for (const call of setVisibleBounds.mock.calls) expect(call[0]).toBeUndefined();
      await board.destroy();
    });

    it("still drives a renderer that does not implement setVisibleBounds", async () => {
      const rebuild = vi.fn(async () => undefined);
      const renderer: RuntimeRenderer = {
        init: async () => undefined,
        rebuild,
        apply: async () => "applied",
        destroy: async () => undefined,
      };
      const board = await createPixiBoard({
        ...options(),
        headless: false,
        container: {} as Element,
        core: { ...options().core, viewportSize: { width: 800, height: 600 } },
        rendererFactory: () => renderer,
      });
      await board.ready;
      board.viewport.panBy(-200, 0);
      await flush();

      expect(rebuild).toHaveBeenCalledOnce();
      await board.destroy();
    });
  });
});
