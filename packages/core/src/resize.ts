import type {
  BoardNode,
  BoardNodePatch,
  JsonValue,
  NodeGeometry,
  NodeResizeRequest,
  Point,
  ResizeHandle,
  ResizePolicy,
} from "./types";

/**
 * How much of the node each handle moves. `-1` moves the west/north edge,
 * `1` moves the east/south edge and `0` leaves that axis anchored.
 */
const HANDLE_AXES: Record<ResizeHandle, { horizontal: -1 | 0 | 1; vertical: -1 | 0 | 1 }> = {
  nw: { horizontal: -1, vertical: -1 },
  n: { horizontal: 0, vertical: -1 },
  ne: { horizontal: 1, vertical: -1 },
  e: { horizontal: 1, vertical: 0 },
  se: { horizontal: 1, vertical: 1 },
  s: { horizontal: 0, vertical: 1 },
  sw: { horizontal: -1, vertical: 1 },
  w: { horizontal: -1, vertical: 0 },
};

export const RESIZE_HANDLES: readonly ResizeHandle[] = Object.freeze([
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const);

/**
 * Which edges a handle moves: `-1` the west/north edge, `1` the east/south
 * edge, `0` neither. Hosts drawing their own control points or laying out a
 * group gesture need the same convention the resolver uses.
 */
export function resizeHandleAxes(handle: ResizeHandle): { horizontal: -1 | 0 | 1; vertical: -1 | 0 | 1 } {
  const axes = HANDLE_AXES[handle];
  if (!axes) throw new RangeError(`Unknown resize handle: ${String(handle)}`);
  return { ...axes };
}

/** Keeps a node from collapsing to a size that can no longer be grabbed. */
const DEFAULT_MIN_SIZE = 1;

export function isResizeHandle(value: unknown): value is ResizeHandle {
  return typeof value === "string" && value in HANDLE_AXES;
}

export function nodeGeometry(node: Readonly<BoardNode<JsonValue>>): NodeGeometry {
  return { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
}

/**
 * Turns one handle drag into the patch that a `ResizePolicy` allows.
 *
 * The delta is given in world units and resolved in the node's own rotated
 * frame, so a rotated node grows along its own axes and the edges the handle
 * does not own stay exactly where they were. Callers that drive a pointer
 * gesture should pass the geometry captured at pointer-down as `origin` and
 * the accumulated delta since then — deriving the delta from the node's
 * current size instead would compound rounding on every frame.
 */
export function resolveResize<Props extends JsonValue>(
  node: Readonly<BoardNode<Props>>,
  policy: ResizePolicy<Props> | undefined,
  request: NodeResizeRequest,
): BoardNodePatch<Props> {
  const axes = HANDLE_AXES[request.handle];
  if (!axes) throw new RangeError(`Unknown resize handle: ${String(request.handle)}`);
  if (!Number.isFinite(request.deltaWorld.x) || !Number.isFinite(request.deltaWorld.y)) {
    throw new RangeError("Resize delta must be finite");
  }

  const origin = request.origin ?? nodeGeometry(node);
  const localDelta = rotatePoint(request.deltaWorld, -origin.rotation);
  const resolved = resolveResizeSize(node, policy, {
    handle: request.handle,
    width: origin.width + axes.horizontal * localDelta.x,
    height: origin.height + axes.vertical * localDelta.y,
    origin,
    ...(request.minWidth === undefined ? {} : { minWidth: request.minWidth }),
    ...(request.minHeight === undefined ? {} : { minHeight: request.minHeight }),
  });
  if (!resolved) return {};

  // Re-anchor so the edges this handle does not own keep their world position.
  // An axis the handle does not touch can still change size under
  // aspect-ratio or a custom policy, and growing it from the centre reads as
  // "the opposite edge did not jump".
  const left = anchorOffset(axes.horizontal, origin.width, resolved.width);
  const top = anchorOffset(axes.vertical, origin.height, resolved.height);
  const offset = rotatePoint({ x: left, y: top }, origin.rotation);

  const patch: BoardNodePatch<Props> = { ...resolved.patch, width: resolved.width, height: resolved.height };
  if (resolved.patch.x === undefined) patch.x = origin.x + offset.x;
  if (resolved.patch.y === undefined) patch.y = origin.y + offset.y;
  return patch;
}

export type ResizeSizeRequest = {
  handle: ResizeHandle;
  /** The size the gesture is asking for, before the policy has a say. */
  width: number;
  height: number;
  /** Geometry the gesture started from; defaults to the node's own. */
  origin?: NodeGeometry;
  minWidth?: number;
  minHeight?: number;
};

export type ResolvedResizeSize<Props extends JsonValue> = {
  width: number;
  height: number;
  /** Extra fields a `custom` policy returned alongside the size. */
  patch: BoardNodePatch<Props>;
};

/**
 * Runs a requested size through a `ResizePolicy` without deciding where the
 * node ends up. Hosts that position nodes themselves — a group gesture scaling
 * a shared bounding box, a layout pass — need the policy's verdict on size
 * while keeping placement under their own control. `undefined` means the
 * policy refused the resize outright.
 */
export function resolveResizeSize<Props extends JsonValue>(
  node: Readonly<BoardNode<Props>>,
  policy: ResizePolicy<Props> | undefined,
  request: ResizeSizeRequest,
): ResolvedResizeSize<Props> | undefined {
  const axes = HANDLE_AXES[request.handle];
  if (!axes) throw new RangeError(`Unknown resize handle: ${String(request.handle)}`);
  if (!Number.isFinite(request.width) || !Number.isFinite(request.height)) {
    throw new RangeError("Resize size must be finite");
  }

  const mode = policy?.mode ?? "free";
  // A locked node is still selectable and still reports handles to whoever
  // asks, but no gesture may change its geometry.
  if (mode === "fixed" || node.locked === true) return undefined;

  const origin = request.origin ?? nodeGeometry(node);
  const minWidth = Math.max(request.minWidth ?? DEFAULT_MIN_SIZE, 0);
  const minHeight = Math.max(request.minHeight ?? DEFAULT_MIN_SIZE, 0);
  let width = Math.max(request.width, minWidth);
  let height = Math.max(request.height, minHeight);

  if (mode === "aspect-ratio") {
    const constrained = constrainToRatio(
      { width, height },
      { width: origin.width, height: origin.height },
      axes,
      policy?.mode === "aspect-ratio" ? policy.ratio : undefined,
      { minWidth, minHeight },
    );
    width = constrained.width;
    height = constrained.height;
  }

  let patch: BoardNodePatch<Props> = {};
  if (mode === "custom" && policy?.mode === "custom") {
    patch = policy.resize({ node, width, height });
    // The policy owns the final size; it may snap, quantize or refuse it.
    if (typeof patch.width === "number") width = Math.max(patch.width, 0);
    if (typeof patch.height === "number") height = Math.max(patch.height, 0);
  }
  return { width, height, patch };
}

/**
 * The CSS cursor name for a handle on a node rotated by `rotation` radians.
 * The four diagonal cursors repeat every 180°, so the handle's own compass
 * angle plus the node's rotation collapses onto one of them.
 */
export function resizeHandleCursor(handle: ResizeHandle, rotation = 0): string {
  const base: Record<ResizeHandle, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
  const degrees = base[handle] + (rotation * 180) / Math.PI;
  const normalized = ((degrees % 180) + 180) % 180;
  const names = ["ns", "nesw", "ew", "nwse"] as const;
  return `${names[Math.round(normalized / 45) % 4]}-resize`;
}

function anchorOffset(axis: -1 | 0 | 1, originSize: number, size: number): number {
  if (axis === 1) return 0;
  if (axis === -1) return originSize - size;
  return (originSize - size) / 2;
}

function constrainToRatio(
  size: { width: number; height: number },
  origin: { width: number; height: number },
  axes: { horizontal: -1 | 0 | 1; vertical: -1 | 0 | 1 },
  declaredRatio: number | undefined,
  limits: { minWidth: number; minHeight: number },
): { width: number; height: number } {
  const ratio = declaredRatio !== undefined && Number.isFinite(declaredRatio) && declaredRatio > 0
    ? declaredRatio
    : origin.height > 0 && origin.width > 0
      ? origin.width / origin.height
      : 1;

  let { width, height } = size;
  if (axes.horizontal !== 0 && axes.vertical !== 0) {
    // A corner drag can follow either axis; the one the pointer moved further
    // along (measured in the same unit) wins so the node tracks the cursor.
    const widthDrives = Math.abs(width - origin.width) >= Math.abs(height - origin.height) * ratio;
    if (widthDrives) height = width / ratio;
    else width = height * ratio;
  } else if (axes.horizontal !== 0) {
    height = width / ratio;
  } else {
    width = height * ratio;
  }

  // Clamping has to preserve the ratio, so a floor on one axis lifts the other.
  if (width < limits.minWidth) {
    width = limits.minWidth;
    height = width / ratio;
  }
  if (height < limits.minHeight) {
    height = limits.minHeight;
    width = height * ratio;
  }
  return { width, height };
}

function rotatePoint(point: Point, angle: number): Point {
  if (!angle) return { x: point.x, y: point.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}
