import { describe, expect, it } from "vitest";
import {
  BoardCore,
  NodeTypeRegistry,
  NodeValidationError,
  resizeHandleCursor,
  resolveResize,
  resolveResizeSize,
  rotatedRectBounds,
  RESIZE_HANDLES,
  type BoardNode,
  type NodeTypeDefinition,
  type ResizePolicy,
} from "../src";

type BoxProps = { label: string };

function boxDefinition(resize?: ResizePolicy<BoxProps>): NodeTypeDefinition<BoxProps> {
  return {
    type: "demo.box",
    version: 1,
    defaults: { label: "" },
    validate: (value) => ({ label: typeof (value as BoxProps)?.label === "string" ? (value as BoxProps).label : "" }),
    getBounds: rotatedRectBounds,
    ...(resize ? { resize } : {}),
  };
}

function box(overrides: Partial<BoardNode<BoxProps>> = {}): BoardNode<BoxProps> {
  return {
    id: "box",
    type: "demo.box",
    typeVersion: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    zIndex: 0,
    props: { label: "" },
    ...overrides,
  };
}

function createCore(resize?: ResizePolicy<BoxProps>): BoardCore {
  const nodeTypes = new NodeTypeRegistry();
  nodeTypes.register(boxDefinition(resize));
  let id = 0;
  const core = new BoardCore({ nodeTypes, idFactory: () => `id-${++id}`, now: () => 1 });
  core.nodes.create<BoxProps>({ ...box(), props: { label: "a" } });
  // Seeding is setup, not part of the gesture under test — drop its entry so
  // canUndo() reflects only what each test does.
  core.history.clear();
  return core;
}

describe("resolveResize handle geometry", () => {
  it("moves only the edges the handle owns", () => {
    const node = box();
    expect(resolveResize(node, { mode: "free" }, { handle: "se", deltaWorld: { x: 40, y: 20 } }))
      .toEqual({ x: 100, y: 100, width: 240, height: 120 });
    // Dragging north-west grows the node backwards: the south-east corner is
    // what has to stay put.
    expect(resolveResize(node, { mode: "free" }, { handle: "nw", deltaWorld: { x: -40, y: -20 } }))
      .toEqual({ x: 60, y: 80, width: 240, height: 120 });
  });

  it("leaves the cross axis untouched for edge handles", () => {
    const node = box();
    expect(resolveResize(node, { mode: "free" }, { handle: "e", deltaWorld: { x: 50, y: 999 } }))
      .toEqual({ x: 100, y: 100, width: 250, height: 100 });
    expect(resolveResize(node, { mode: "free" }, { handle: "n", deltaWorld: { x: 999, y: -30 } }))
      .toEqual({ x: 100, y: 70, width: 200, height: 130 });
  });

  it("resolves the drag in the node's own frame when it is rotated", () => {
    // Rotated 90°: the node's local +x now points along world +y, so a drag
    // straight down the screen must grow its width, not its height.
    const node = box({ rotation: Math.PI / 2 });
    const patch = resolveResize(node, { mode: "free" }, { handle: "e", deltaWorld: { x: 0, y: 40 } });
    expect(patch.width).toBeCloseTo(240);
    expect(patch.height).toBeCloseTo(100);
    // The west edge is anchored, so the origin must not move.
    expect(patch.x).toBeCloseTo(100);
    expect(patch.y).toBeCloseTo(100);
  });

  it("accumulates against the gesture origin rather than the live node", () => {
    const node = box();
    const origin = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
    const first = resolveResize(node, { mode: "free" }, { handle: "se", deltaWorld: { x: 10, y: 0 }, origin });
    const later = resolveResize({ ...node, width: first.width! }, { mode: "free" }, {
      handle: "se",
      deltaWorld: { x: 30, y: 0 },
      origin,
    });
    // The second call sees the total delta, not an increment, so the node ends
    // up 30 wider than it started — not 40.
    expect(later.width).toBe(230);
  });

  it("clamps to the minimum size instead of inverting the node", () => {
    const node = box();
    const patch = resolveResize(node, { mode: "free" }, {
      handle: "se",
      deltaWorld: { x: -500, y: -500 },
      minWidth: 20,
      minHeight: 20,
    });
    expect(patch).toEqual({ x: 100, y: 100, width: 20, height: 20 });
  });

  it("rejects a non-finite delta", () => {
    expect(() => resolveResize(box(), { mode: "free" }, { handle: "se", deltaWorld: { x: NaN, y: 0 } }))
      .toThrow(RangeError);
  });
});

describe("ResizePolicy modes", () => {
  it("mode:fixed refuses every handle", () => {
    for (const handle of RESIZE_HANDLES) {
      expect(resolveResize(box(), { mode: "fixed" }, { handle, deltaWorld: { x: 50, y: 50 } })).toEqual({});
    }
  });

  it("a locked node refuses resizing regardless of policy", () => {
    expect(resolveResize(box({ locked: true }), { mode: "free" }, { handle: "se", deltaWorld: { x: 50, y: 50 } }))
      .toEqual({});
  });

  it("mode:aspect-ratio keeps the node's own ratio and re-anchors the cross axis", () => {
    const node = box();
    const patch = resolveResize(node, { mode: "aspect-ratio" }, { handle: "e", deltaWorld: { x: 100, y: 0 } });
    expect(patch.width).toBe(300);
    expect(patch.height).toBe(150);
    // The east handle owns no vertical edge, so the extra height grows from
    // the centre and the node stays vertically centred on where it was.
    expect(patch.y).toBe(75);
    expect(patch.x).toBe(100);
  });

  it("mode:aspect-ratio honours a declared ratio over the node's current one", () => {
    const patch = resolveResize(box(), { mode: "aspect-ratio", ratio: 1 }, {
      handle: "e",
      deltaWorld: { x: 100, y: 0 },
    });
    expect(patch.width).toBe(300);
    expect(patch.height).toBe(300);
  });

  it("mode:aspect-ratio lifts both axes together when one hits its floor", () => {
    const patch = resolveResize(box(), { mode: "aspect-ratio", ratio: 2 }, {
      handle: "se",
      deltaWorld: { x: -500, y: -500 },
      minWidth: 40,
      minHeight: 40,
    });
    expect(patch.width).toBe(80);
    expect(patch.height).toBe(40);
  });

  it("mode:custom gets the last word on the resulting size", () => {
    const policy: ResizePolicy<BoxProps> = {
      mode: "custom",
      // Snap to a 50px grid.
      resize: ({ width, height }) => ({ width: Math.round(width / 50) * 50, height: Math.round(height / 50) * 50 }),
    };
    const patch = resolveResize(box(), policy, { handle: "se", deltaWorld: { x: 37, y: 12 } });
    expect(patch.width).toBe(250);
    expect(patch.height).toBe(100);
  });

  it("mode:custom may also patch props and pin its own placement", () => {
    const policy: ResizePolicy<BoxProps> = {
      mode: "custom",
      resize: ({ width }) => ({ width, x: 0, props: { label: `w:${Math.round(width)}` } }),
    };
    const patch = resolveResize(box(), policy, { handle: "w", deltaWorld: { x: -20, y: 0 } });
    expect(patch).toMatchObject({ x: 0, width: 220, props: { label: "w:220" } });
    // The policy did not pin y, so the resolver still anchors it.
    expect(patch.y).toBe(100);
  });

  it("resolveResizeSize reports the policy verdict without placing the node", () => {
    expect(resolveResizeSize(box(), { mode: "aspect-ratio", ratio: 2 }, { handle: "se", width: 400, height: 10 }))
      .toMatchObject({ width: 400, height: 200 });
    expect(resolveResizeSize(box(), { mode: "fixed" }, { handle: "se", width: 400, height: 400 }))
      .toBeUndefined();
  });
});

describe("nodes.resize()", () => {
  it("commits through the policy and records history", () => {
    const core = createCore({ mode: "aspect-ratio", ratio: 2 });
    const resized = core.nodes.resize<BoxProps>("box", { handle: "se", deltaWorld: { x: 100, y: 0 } });
    expect(resized).toMatchObject({ width: 300, height: 150 });
    core.history.undo();
    expect(core.nodes.get("box")).toMatchObject({ width: 200, height: 100 });
  });

  it("does not open a revision when the policy refuses the resize", () => {
    const core = createCore({ mode: "fixed" });
    const before = core.document.snapshot().revision;
    core.nodes.resize("box", { handle: "se", deltaWorld: { x: 100, y: 100 } });
    expect(core.document.snapshot().revision).toBe(before);
    expect(core.history.canUndo()).toBe(false);
  });

  it("treats a node type without a declared policy as free", () => {
    const core = createCore();
    expect(core.nodes.resize("box", { handle: "se", deltaWorld: { x: 50, y: 25 } }))
      .toMatchObject({ width: 250, height: 125 });
  });
});

describe("registration validation", () => {
  it("rejects a custom policy with no resize function", () => {
    const registry = new NodeTypeRegistry();
    expect(() => registry.register(boxDefinition({ mode: "custom" } as never)))
      .toThrow(NodeValidationError);
  });

  it("rejects an unknown mode and a non-positive ratio", () => {
    const registry = new NodeTypeRegistry();
    expect(() => registry.register(boxDefinition({ mode: "stretch" } as never))).toThrow(NodeValidationError);
    expect(() => registry.register(boxDefinition({ mode: "aspect-ratio", ratio: 0 }))).toThrow(NodeValidationError);
  });
});

describe("resizeHandleCursor", () => {
  it("names the axis each handle drags", () => {
    expect(resizeHandleCursor("n")).toBe("ns-resize");
    expect(resizeHandleCursor("e")).toBe("ew-resize");
    expect(resizeHandleCursor("nw")).toBe("nwse-resize");
    expect(resizeHandleCursor("ne")).toBe("nesw-resize");
  });

  it("rotates with the node so the cursor still points along the dragged edge", () => {
    expect(resizeHandleCursor("n", Math.PI / 2)).toBe("ew-resize");
    expect(resizeHandleCursor("nw", Math.PI / 2)).toBe("nesw-resize");
    // A half turn maps every handle back onto its own cursor.
    for (const handle of RESIZE_HANDLES) {
      expect(resizeHandleCursor(handle, Math.PI)).toBe(resizeHandleCursor(handle));
    }
  });
});

describe("history coalescing", () => {
  it("collapses a multi-frame gesture into one undo step", () => {
    const core = createCore();
    const key = "gesture-1";
    for (const delta of [10, 20, 30, 40]) {
      core.transaction("Resize selection", () => {
        core.nodes.resize("box", { handle: "se", deltaWorld: { x: delta, y: 0 }, origin: { x: 100, y: 100, width: 200, height: 100, rotation: 0 } });
      }, { origin: "ui", coalesceKey: key });
    }
    expect(core.nodes.get("box")).toMatchObject({ width: 240 });
    // Every frame still got its own revision; only history was merged.
    expect(core.document.snapshot().revision).toBe(5);

    core.history.undo();
    expect(core.nodes.get("box")).toMatchObject({ width: 200 });
    expect(core.history.canUndo()).toBe(false);

    core.history.redo();
    expect(core.nodes.get("box")).toMatchObject({ width: 240 });
  });

  it("starts a new undo step for each distinct key", () => {
    const core = createCore();
    core.transaction("Resize selection", () => {
      core.nodes.update("box", { width: 300 });
    }, { origin: "ui", coalesceKey: "gesture-1" });
    core.transaction("Resize selection", () => {
      core.nodes.update("box", { width: 400 });
    }, { origin: "ui", coalesceKey: "gesture-2" });

    core.history.undo();
    expect(core.nodes.get("box")).toMatchObject({ width: 300 });
    core.history.undo();
    expect(core.nodes.get("box")).toMatchObject({ width: 200 });
  });

  it("does not merge into a neighbouring transaction that carries no key", () => {
    const core = createCore();
    core.transaction("Move", () => { core.nodes.update("box", { x: 0 }); });
    core.transaction("Resize selection", () => {
      core.nodes.update("box", { width: 300 });
    }, { origin: "ui", coalesceKey: "gesture-1" });

    core.history.undo();
    expect(core.nodes.get("box")).toMatchObject({ x: 0, width: 200 });
    core.history.undo();
    expect(core.nodes.get("box")).toMatchObject({ x: 100, width: 200 });
  });
});
