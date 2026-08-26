import {
  nodeGeometry,
  RESIZE_HANDLES,
  resizeHandleAxes,
  resizeHandleCursor,
  resolveResizeSize,
  type BoardNode,
  type BoardNodePatch,
  type JsonValue,
  type NodeGeometry,
  type NodeResizeRequest,
  type Point,
  type ResizeHandle,
  type ResizePolicy,
} from "@pixi-board/core";
import type {
  TransformBounds,
  TransformHandlePlacement,
  TransformSession,
} from "./types";

/**
 * The board surface a transform session needs. Narrowed to the few members it
 * uses so the controller can be tested without a full facade and cannot reach
 * past the public API.
 */
export type TransformHost = {
  selection(): string[];
  getNode(nodeId: string): Readonly<BoardNode<JsonValue>> | undefined;
  resizePolicy(type: string): ResizePolicy<JsonValue> | undefined;
  resize(nodeId: string, request: NodeResizeRequest): void;
  update(nodeId: string, patch: BoardNodePatch<JsonValue>): void;
  transaction(label: string, operation: () => void, options: { origin: "ui"; coalesceKey: string }): void;
  nextId(): string;
};

export type TransformControllerOptions = {
  minWidth?: number;
  minHeight?: number;
  handles?: readonly ResizeHandle[];
};

/** Nothing smaller than this can still be grabbed by its own handles. */
const DEFAULT_MIN_SIZE = 8;

export class TransformController {
  private session?: ActiveSession;

  constructor(
    private readonly host: TransformHost,
    private readonly options: TransformControllerOptions = {},
  ) {}

  bounds(): TransformBounds | undefined {
    const nodes = this.selectedNodes();
    if (nodes.length === 0) return undefined;
    if (nodes.length === 1) {
      const [node] = nodes;
      return {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
        nodeIds: [node.id],
      };
    }

    // A multi-node selection has no shared rotation, so the group box is the
    // axis-aligned hull of every node's rotated corners.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      for (const corner of rotatedCorners(node)) {
        minX = Math.min(minX, corner.x);
        minY = Math.min(minY, corner.y);
        maxX = Math.max(maxX, corner.x);
        maxY = Math.max(maxY, corner.y);
      }
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      nodeIds: nodes.map((node) => node.id),
    };
  }

  handles(): TransformHandlePlacement[] {
    const bounds = this.bounds();
    if (!bounds) return [];
    const cos = Math.cos(bounds.rotation);
    const sin = Math.sin(bounds.rotation);
    const allowed = new Set(this.options.handles ?? RESIZE_HANDLES);
    return RESIZE_HANDLES.filter((handle) => allowed.has(handle)).map((handle) => {
      const local = handleLocalPoint(handle, bounds.width, bounds.height);
      return {
        handle,
        world: {
          x: bounds.x + local.x * cos - local.y * sin,
          y: bounds.y + local.x * sin + local.y * cos,
        },
        cursor: resizeHandleCursor(handle, bounds.rotation),
      };
    });
  }

  begin(handle: ResizeHandle): TransformSession | undefined {
    // A gesture starting while another is live would interleave two sets of
    // origins into one coalesced history entry; end the stale one first.
    this.session?.commit();
    const nodes = this.selectedNodes();
    const bounds = this.bounds();
    if (nodes.length === 0 || !bounds) return undefined;

    const session = new ActiveSession(
      this.host,
      handle,
      nodes,
      bounds,
      `resize:${this.host.nextId()}`,
      {
        minWidth: this.options.minWidth ?? DEFAULT_MIN_SIZE,
        minHeight: this.options.minHeight ?? DEFAULT_MIN_SIZE,
      },
      () => {
        if (this.session === session) this.session = undefined;
      },
    );
    this.session = session;
    return session;
  }

  active(): boolean {
    return this.session !== undefined;
  }

  /** Ends any live gesture; called when the board is destroyed. */
  dispose(): void {
    this.session?.commit();
  }

  private selectedNodes(): Array<Readonly<BoardNode<JsonValue>>> {
    return this.host
      .selection()
      .map((id) => this.host.getNode(id))
      .filter((node): node is Readonly<BoardNode<JsonValue>> => node !== undefined);
  }
}

class ActiveSession implements TransformSession {
  private done = false;
  private readonly origins: Array<{ id: string; type: string; geometry: NodeGeometry }>;

  constructor(
    private readonly host: TransformHost,
    readonly handle: ResizeHandle,
    nodes: Array<Readonly<BoardNode<JsonValue>>>,
    private readonly groupOrigin: TransformBounds,
    private readonly coalesceKey: string,
    private readonly limits: { minWidth: number; minHeight: number },
    private readonly onEnd: () => void,
  ) {
    this.origins = nodes.map((node) => ({ id: node.id, type: node.type, geometry: nodeGeometry(node) }));
  }

  update(deltaWorld: Point, options: { preserveAspectRatio?: boolean } = {}): void {
    if (this.done) return;
    if (!Number.isFinite(deltaWorld.x) || !Number.isFinite(deltaWorld.y)) return;

    this.host.transaction(
      "Resize selection",
      () => {
        if (this.origins.length === 1) {
          const [only] = this.origins;
          // A lone node resizes in its own rotated frame, which is exactly
          // what nodes.resize() already does.
          const adjustedDelta = options.preserveAspectRatio
            ? preserveAspectDelta(deltaWorld, this.handle, only.geometry)
            : deltaWorld;
          this.host.resize(only.id, {
            handle: this.handle,
            deltaWorld: adjustedDelta,
            origin: only.geometry,
            minWidth: this.limits.minWidth,
            minHeight: this.limits.minHeight,
          });
          return;
        }
        this.scaleGroup(deltaWorld, options.preserveAspectRatio === true);
      },
      { origin: "ui", coalesceKey: this.coalesceKey },
    );
  }

  commit(): void {
    if (this.done) return;
    this.done = true;
    this.onEnd();
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    // The gesture already committed real transactions, so restoring means
    // writing the captured geometry back — under the same coalesce key, so
    // the whole aborted gesture still collapses into one undo step that the
    // user can then undo away entirely.
    this.host.transaction(
      "Resize selection",
      () => {
        for (const { id, geometry } of this.origins) {
          this.host.update(id, {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
          });
        }
      },
      { origin: "ui", coalesceKey: this.coalesceKey },
    );
    this.onEnd();
  }

  /**
   * Scales the shared group box by the handle drag, then maps every node into
   * the new box: its offset from the anchored corner and its size both scale
   * by the same factor, so the selection resizes as one rigid unit.
   *
   * Each node's size still goes through its own ResizePolicy, so a fixed node
   * inside a multi-selection keeps its size (and its scaled position) while
   * its neighbours grow. Placement is computed here rather than by
   * nodes.resize(), which would re-anchor each node against its own origin
   * and tear the group apart.
   */
  private scaleGroup(deltaWorld: Point, preserveAspectRatio: boolean): void {
    const box = this.groupOrigin;
    const axes = resizeHandleAxes(this.handle);
    const width = Math.max(box.width + axes.horizontal * deltaWorld.x, this.limits.minWidth);
    const height = Math.max(box.height + axes.vertical * deltaWorld.y, this.limits.minHeight);
    // A group with no extent on an axis (every node stacked on one line) has
    // no meaningful scale factor there; leave that axis alone instead of
    // dividing by zero.
    let scaleX = box.width > 0 ? width / box.width : 1;
    let scaleY = box.height > 0 ? height / box.height : 1;
    if (preserveAspectRatio && axes.horizontal !== 0 && axes.vertical !== 0) {
      const scale = Math.max(scaleX, scaleY);
      scaleX = scale;
      scaleY = scale;
    }
    // The handle drags one side; the opposite side is what everything is
    // measured from. A mid-edge handle leaves its cross axis anchored at the
    // box origin, which is the same as not scaling that axis at all.
    const anchorX = axes.horizontal === -1 ? box.x + box.width : box.x;
    const anchorY = axes.vertical === -1 ? box.y + box.height : box.y;

    for (const { id, type, geometry } of this.origins) {
      const node = this.host.getNode(id);
      if (!node) continue;
      const resolved = resolveResizeSize(node, this.host.resizePolicy(type), {
        handle: this.handle,
        width: geometry.width * scaleX,
        height: geometry.height * scaleY,
        origin: geometry,
        minWidth: this.limits.minWidth,
        minHeight: this.limits.minHeight,
      });
      // The policy refused this node; it keeps both its size and its original
      // place so a fixed node does not drift under the group gesture.
      if (!resolved) continue;
      this.host.update(id, {
        ...resolved.patch,
        x: anchorX + (geometry.x - anchorX) * scaleX,
        y: anchorY + (geometry.y - anchorY) * scaleY,
        width: resolved.width,
        height: resolved.height,
      });
    }
  }
}

function preserveAspectDelta(deltaWorld: Point, handle: ResizeHandle, origin: NodeGeometry): Point {
  const axes = resizeHandleAxes(handle);
  if (axes.horizontal === 0 || axes.vertical === 0 || origin.width <= 0 || origin.height <= 0) return deltaWorld;
  const ratio = origin.width / origin.height;
  const cos = Math.cos(origin.rotation);
  const sin = Math.sin(origin.rotation);
  const localDelta = { x: deltaWorld.x * cos + deltaWorld.y * sin, y: -deltaWorld.x * sin + deltaWorld.y * cos };
  const widthDelta = axes.horizontal * localDelta.x;
  const heightDelta = axes.vertical * localDelta.y;
  let localResult: Point;
  if (Math.abs(widthDelta) >= Math.abs(heightDelta) * ratio) {
    localResult = { x: localDelta.x, y: axes.vertical * (widthDelta / ratio) };
  } else {
    localResult = { x: axes.horizontal * (heightDelta * ratio), y: localDelta.y };
  }
  return { x: localResult.x * cos - localResult.y * sin, y: localResult.x * sin + localResult.y * cos };
}

function handleLocalPoint(handle: ResizeHandle, width: number, height: number): Point {
  const axes = resizeHandleAxes(handle);
  return {
    x: axes.horizontal === -1 ? 0 : axes.horizontal === 1 ? width : width / 2,
    y: axes.vertical === -1 ? 0 : axes.vertical === 1 ? height : height / 2,
  };
}

function rotatedCorners(node: Readonly<BoardNode<JsonValue>>): Point[] {
  const cos = Math.cos(node.rotation);
  const sin = Math.sin(node.rotation);
  return [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: node.width, y: node.height },
    { x: 0, y: node.height },
  ].map((point) => ({
    x: node.x + point.x * cos - point.y * sin,
    y: node.y + point.x * sin + point.y * cos,
  }));
}
