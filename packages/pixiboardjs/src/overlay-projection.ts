import type { BoardNode, JsonValue, Point, ViewportSnapshot, WorldBounds } from "@pixi-board/core";
import { rotatedRectBounds } from "@pixi-board/core";

/**
 * Where on a node's world bounds an overlay item hangs.
 *
 * The named values are the nine box positions; the object form takes
 * normalized coordinates so a caller can anchor at, say, the 25% mark without
 * the enum growing a case for it.
 */
export type OverlayAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right"
  | { x: number; y: number };

/**
 * How an item's own size reacts to zoom. This is deliberately independent of
 * the anchor: *where* something sits and *how big it draws* are different
 * questions, and every combination of the two is legitimate.
 *
 * - `screen` — constant CSS pixels at any zoom. Correct for chrome that
 *   describes content without being part of it: labels, badges, tooltips.
 * - `world` — scales 1:1 with the viewport, so it behaves like content.
 *   Correct for annotations that belong to the document.
 * - `clamped` — scales with the viewport but stops at `min`/`max`, so an
 *   annotation stays legible when zoomed far out without growing absurdly
 *   when zoomed in.
 */
export type OverlayScaleMode =
  | "screen"
  | "world"
  | { mode: "clamped"; min: number; max: number };

/**
 * What happens to an item when the viewport is zoomed out far enough that
 * items would otherwise pile onto each other.
 *
 * `collapse` only describes intent; the DOM layer decides how to express it
 * (a modifier class, typically) so this module stays render-agnostic.
 */
export type OverlayDeclutter = {
  /** Below this viewport scale the item is dropped entirely. */
  minScale?: number;
  /** Below this viewport scale the item is reported as collapsed. */
  collapseBelowScale?: number;
};

export type OverlayItem = {
  /**
   * Stable within one layer. Defaults to the node id; supply it explicitly
   * when one node contributes several items, otherwise they would share a
   * pooled element and overwrite each other.
   */
  key?: string;
  anchor?: OverlayAnchor;
  /** Screen-pixel nudge applied after anchoring, before scaling. */
  offset?: Point;
  scale?: OverlayScaleMode;
  declutter?: OverlayDeclutter;
  /** Opaque payload handed back to the renderer callback. */
  data?: unknown;
  className?: string;
};

export type OverlayPlacement = {
  key: string;
  nodeId: string;
  /** Screen position of the anchor point, in CSS pixels. */
  screen: Point;
  /** Multiplier the item should draw itself at; 1 for `screen` mode. */
  scale: number;
  collapsed: boolean;
  data?: unknown;
  className?: string;
};

export type OverlayBoundsResolver = (node: Readonly<BoardNode<JsonValue>>) => WorldBounds;

/**
 * The world bounds every overlay measures against — the same resolver the
 * renderer culls with, so an overlay never drifts from what the user sees.
 *
 * Everything that positions or sizes an overlay must go through this. Mixing a
 * node's raw `x`/`y` with dimensions taken from resolved bounds puts the two in
 * different coordinate frames, which shows up as a box that is displaced from
 * the very outlines it is supposed to enclose.
 */
export function resolveOverlayBounds(
  node: Readonly<BoardNode<JsonValue>>,
  nodeTypes: { get(type: string): { getBounds(node: BoardNode<never>): WorldBounds } | undefined },
): WorldBounds {
  const definition = nodeTypes.get(node.type);
  return definition ? definition.getBounds(node as BoardNode<never>) : rotatedRectBounds(node as BoardNode);
}

const ANCHOR_RATIOS: Record<Exclude<OverlayAnchor, { x: number; y: number }>, Point> = {
  "top-left": { x: 0, y: 0 },
  top: { x: 0.5, y: 0 },
  "top-right": { x: 1, y: 0 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 },
  bottom: { x: 0.5, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

export function anchorRatio(anchor: OverlayAnchor = "top-left"): Point {
  if (typeof anchor === "object") {
    assertFinitePoint(anchor, "anchor");
    return anchor;
  }
  const ratio = ANCHOR_RATIOS[anchor];
  if (!ratio) throw new RangeError(`Unknown overlay anchor: ${String(anchor)}`);
  return ratio;
}

/**
 * The world point an item hangs from.
 *
 * Anchoring uses the node's *world bounds* rather than its raw x/y/width so a
 * rotated or custom-bounds node still gets a label that hugs what the user
 * actually sees.
 */
export function anchorWorldPoint(bounds: WorldBounds, anchor: OverlayAnchor = "top-left"): Point {
  const ratio = anchorRatio(anchor);
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) * ratio.x,
    y: bounds.minY + (bounds.maxY - bounds.minY) * ratio.y,
  };
}

export function resolveScale(mode: OverlayScaleMode | undefined, viewportScale: number): number {
  if (mode === undefined || mode === "screen") return 1;
  if (mode === "world") return viewportScale;
  if (typeof mode === "object" && mode.mode === "clamped") {
    if (!Number.isFinite(mode.min) || !Number.isFinite(mode.max) || mode.min <= 0 || mode.max < mode.min) {
      throw new RangeError("clamped overlay scale requires 0 < min <= max");
    }
    return Math.min(Math.max(viewportScale, mode.min), mode.max);
  }
  throw new RangeError("Unknown overlay scale mode");
}

/**
 * Projects one item into screen space, or returns undefined when declutter
 * rules say it should not exist at this zoom at all.
 *
 * Kept free of DOM types on purpose: this is the part worth unit-testing, and
 * the workspace's test runner is a plain Node environment.
 */
export function projectOverlayItem(
  node: Readonly<BoardNode<JsonValue>>,
  item: OverlayItem,
  viewport: ViewportSnapshot,
  bounds: WorldBounds,
): OverlayPlacement | undefined {
  const declutter = item.declutter;
  if (declutter?.minScale !== undefined && viewport.scale < declutter.minScale) return undefined;

  const world = anchorWorldPoint(bounds, item.anchor);
  const offset = item.offset ?? { x: 0, y: 0 };
  assertFinitePoint(offset, "offset");

  return {
    key: item.key ?? node.id,
    nodeId: node.id,
    screen: {
      x: world.x * viewport.scale + viewport.offset.x + offset.x,
      y: world.y * viewport.scale + viewport.offset.y + offset.y,
    },
    scale: resolveScale(item.scale, viewport.scale),
    collapsed:
      declutter?.collapseBelowScale !== undefined && viewport.scale < declutter.collapseBelowScale,
    data: item.data,
    className: item.className,
  };
}

function assertFinitePoint(point: Point, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} must be finite`);
  }
}
