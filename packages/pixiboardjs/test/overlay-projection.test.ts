import { describe, expect, it } from "vitest";
import { rotatedRectBounds, type BoardNode, type ViewportSnapshot } from "@pixi-board/core";
import {
  anchorWorldPoint,
  projectOverlayItem,
  resolveOverlayBounds,
  resolveScale,
  type OverlayItem,
} from "../src/overlay-projection";

function node(overrides: Partial<BoardNode> = {}): BoardNode {
  return {
    id: "n1",
    type: "rect",
    typeVersion: 1,
    x: 100,
    y: 200,
    width: 40,
    height: 20,
    rotation: 0,
    zIndex: 0,
    props: {},
    ...overrides,
  };
}

const identity: ViewportSnapshot = { scale: 1, offset: { x: 0, y: 0 } };

function project(item: OverlayItem, viewport: ViewportSnapshot = identity, target = node()) {
  return projectOverlayItem(target, item, viewport, rotatedRectBounds(target));
}

describe("anchorWorldPoint", () => {
  it("resolves the nine named anchors against world bounds", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(anchorWorldPoint(bounds, "top-left")).toEqual({ x: 0, y: 0 });
    expect(anchorWorldPoint(bounds, "center")).toEqual({ x: 50, y: 25 });
    expect(anchorWorldPoint(bounds, "bottom-right")).toEqual({ x: 100, y: 50 });
    expect(anchorWorldPoint(bounds, "bottom")).toEqual({ x: 50, y: 50 });
  });

  it("accepts normalized custom anchors", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(anchorWorldPoint(bounds, { x: 0.25, y: 0.5 })).toEqual({ x: 25, y: 25 });
  });

  it("rejects unknown and non-finite anchors", () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    expect(() => anchorWorldPoint(bounds, "middle" as never)).toThrow(RangeError);
    expect(() => anchorWorldPoint(bounds, { x: Number.NaN, y: 0 })).toThrow(RangeError);
  });

  it("anchors a rotated node against its rotated bounds, not its raw rect", () => {
    const rotated = node({ rotation: Math.PI / 2 });
    const bounds = rotatedRectBounds(rotated);
    // A quarter turn puts the visual top-left left of the node's own x.
    expect(anchorWorldPoint(bounds, "top-left").x).toBeLessThan(rotated.x);
  });
});

describe("resolveScale", () => {
  it("keeps screen mode at 1 regardless of zoom", () => {
    expect(resolveScale("screen", 4)).toBe(1);
    expect(resolveScale(undefined, 0.1)).toBe(1);
  });

  it("tracks the viewport in world mode", () => {
    expect(resolveScale("world", 2.5)).toBe(2.5);
  });

  it("clamps to the configured band", () => {
    const mode = { mode: "clamped", min: 0.5, max: 2 } as const;
    expect(resolveScale(mode, 0.1)).toBe(0.5);
    expect(resolveScale(mode, 1.25)).toBe(1.25);
    expect(resolveScale(mode, 8)).toBe(2);
  });

  it("rejects an inverted or non-positive clamp band", () => {
    expect(() => resolveScale({ mode: "clamped", min: 2, max: 1 }, 1)).toThrow(RangeError);
    expect(() => resolveScale({ mode: "clamped", min: 0, max: 1 }, 1)).toThrow(RangeError);
  });
});

describe("projectOverlayItem", () => {
  it("projects the anchor through the viewport transform", () => {
    const placement = project({ anchor: "top-left" }, { scale: 2, offset: { x: 10, y: 5 } });
    expect(placement?.screen).toEqual({ x: 210, y: 405 });
  });

  it("applies the offset in screen pixels, after scaling", () => {
    const zoomed = project({ offset: { x: 6, y: -3 } }, { scale: 3, offset: { x: 0, y: 0 } });
    const identityOffset = project({ offset: { x: 6, y: -3 } });
    // The same offset moves the item the same number of CSS pixels at any
    // zoom, which is what makes a 6px gap look like a 6px gap.
    expect(zoomed!.screen.x - 100 * 3).toBe(identityOffset!.screen.x - 100);
  });

  it("defaults the key to the node id and honours an explicit one", () => {
    expect(project({}).key).toBe("n1");
    expect(project({ key: "n1:badge" }).key).toBe("n1:badge");
  });

  it("drops the item below minScale", () => {
    const item: OverlayItem = { declutter: { minScale: 0.5 } };
    expect(project(item, { scale: 0.49, offset: { x: 0, y: 0 } })).toBeUndefined();
    expect(project(item, { scale: 0.5, offset: { x: 0, y: 0 } })).toBeDefined();
  });

  it("reports collapse without dropping the item", () => {
    const item: OverlayItem = { declutter: { collapseBelowScale: 1 } };
    expect(project(item, { scale: 0.9, offset: { x: 0, y: 0 } })?.collapsed).toBe(true);
    expect(project(item, { scale: 1, offset: { x: 0, y: 0 } })?.collapsed).toBe(false);
  });

  it("passes data and className through untouched", () => {
    const data = { kind: "image" };
    const placement = project({ data, className: "badge" });
    expect(placement?.data).toBe(data);
    expect(placement?.className).toBe("badge");
  });

  it("rejects a non-finite offset rather than emitting NaN coordinates", () => {
    expect(() => project({ offset: { x: Number.POSITIVE_INFINITY, y: 0 } })).toThrow(RangeError);
  });
});

describe("resolveOverlayBounds", () => {
  const noTypes = { get: () => undefined };

  it("falls back to rotated bounds, not the raw rect", () => {
    // A rotated node's bounds do not start at node.x/node.y. Anything that
    // positions an overlay from the raw origin while sizing it from these
    // bounds ends up in two different coordinate frames.
    const rotated = node({ rotation: Math.PI / 4 });
    const bounds = resolveOverlayBounds(rotated, noTypes);

    expect(bounds).toEqual(rotatedRectBounds(rotated));
    expect(bounds.minX).toBeLessThan(rotated.x);
    // The raw rect fallback would have produced exactly this, which is the
    // frame mismatch the shared resolver removes.
    expect(bounds).not.toEqual({
      minX: rotated.x,
      minY: rotated.y,
      maxX: rotated.x + rotated.width,
      maxY: rotated.y + rotated.height,
    });
  });

  it("prefers a registered node type's own bounds", () => {
    const custom = { minX: -5, minY: -6, maxX: 7, maxY: 8 };
    const bounds = resolveOverlayBounds(node(), { get: () => ({ getBounds: () => custom }) });
    expect(bounds).toEqual(custom);
  });

  it("is the single frame a selection box and its outlines share", () => {
    // Reproduces the group-box bug: deriving the origin from node.x/node.y
    // while deriving the extent from resolved bounds leaves the box displaced
    // from the outlines it should enclose.
    const rotated = node({ rotation: Math.PI / 4 });
    const bounds = resolveOverlayBounds(rotated, noTypes);
    const outlineTopLeft = anchorWorldPoint(bounds, "top-left");

    expect(outlineTopLeft).toEqual({ x: bounds.minX, y: bounds.minY });
    expect(outlineTopLeft.x).not.toBeCloseTo(rotated.x);
  });
});
