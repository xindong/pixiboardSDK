import type { BoardNode, JsonValue, WorldBounds } from "@pixi-board/core";
import { projectOverlayItem, resolveOverlayBounds, type OverlayItem, type OverlayPlacement } from "./overlay-projection";
import type { PixiBoard } from "./types";

export type OverlayRenderContext = {
  /** The element to fill. Reused across nodes — clear anything you own. */
  element: HTMLElement;
  placement: OverlayPlacement;
  node: Readonly<BoardNode<JsonValue>>;
};

export type OverlayLayerOptions = {
  /**
   * Where item elements are appended. Must be positioned, sized like the
   * canvas, and normally `pointer-events: none` so the board keeps receiving
   * input; an item that needs clicks can re-enable them on itself.
   */
  container: HTMLElement;
  /**
   * Produces the overlay item for a node, or undefined for "nothing here".
   * Called for every candidate node on every rebuild, so keep it cheap and
   * free of side effects.
   */
  item(node: Readonly<BoardNode<JsonValue>>): OverlayItem | undefined;
  /** Fills a pooled element. Called whenever the item's content may have changed. */
  render(context: OverlayRenderContext): void;
  /** Class applied to every pooled element. Defaults to `pixiboard-overlay-item`. */
  itemClassName?: string;
  /** Class applied while an item is collapsed by declutter rules. */
  collapsedClassName?: string;
  /**
   * For interactive overlay items, forwards wheel gestures back to this board
   * surface so zooming and panning do not get trapped in the DOM layer.
   */
  wheelSurface?: HTMLElement;
  /**
   * Restricts the layer to a set of candidate nodes. Defaults to the board's
   * visible set, so overlay cost tracks what is on screen rather than document
   * size — the whole point of pairing an overlay with a virtualized renderer.
   *
   * Returning undefined means "no culling information", and the layer falls
   * back to the whole document rather than showing nothing. Supply a function
   * that always returns undefined to opt out of culling entirely.
   */
  candidates?(): Iterable<string> | undefined;
  /**
   * Runs at the end of every flush, inside the same batched frame. Use it for
   * chrome that belongs to the layer but is not per-node — a bounding box
   * around a whole selection, say — so it shares one animation frame with the
   * items instead of scheduling a second pass of its own.
   */
  onFlush?(): void;
  /** Schedules a batched flush. Defaults to `requestAnimationFrame`. */
  schedule?(callback: () => void): () => void;
};

export type OverlayLayer = {
  /** Marks the layer dirty; the flush itself is batched. */
  refresh(): void;
  /** Flushes any pending work immediately. Mostly for tests and teardown. */
  flush(): void;
  /** Number of elements currently attached (pooled spares excluded). */
  size(): number;
  destroy(): void;
};

const DEFAULT_ITEM_CLASS = "pixiboard-overlay-item";
const DEFAULT_COLLAPSED_CLASS = "pixiboard-overlay-item-collapsed";

/**
 * Projects board nodes onto positioned DOM elements that track the viewport.
 *
 * Three implementation choices are load-bearing rather than incidental:
 *
 * 1. **Elements are pooled by key.** A naive layer calls `replaceChildren()`
 *    every frame, which throws away and rebuilds the whole subtree during a
 *    pan — the single most expensive thing an overlay can do.
 * 2. **Positioning goes through `transform`, never `left`/`top`.** Writing
 *    `left`/`top` per frame forces layout for every item; a transform is
 *    handled by the compositor.
 * 3. **Flushes are batched into one animation frame.** Viewport and document
 *    changes both invalidate the layer and routinely arrive together, so
 *    reacting to each one directly would project everything several times per
 *    frame.
 */
export function attachOverlayLayer(board: PixiBoard, options: OverlayLayerOptions): OverlayLayer {
  const itemClassName = options.itemClassName ?? DEFAULT_ITEM_CLASS;
  const collapsedClassName = options.collapsedClassName ?? DEFAULT_COLLAPSED_CLASS;
  const schedule = options.schedule ?? defaultSchedule;

  /** Live elements, keyed by overlay item key. */
  const active = new Map<string, HTMLElement>();
  /**
   * Detached elements kept for reuse. A pan across a dense document otherwise
   * churns hundreds of elements per second through the allocator.
   */
  const pool: HTMLElement[] = [];
  const applied = new WeakMap<HTMLElement, { className: string; transform: string }>();
  const disposers: Array<() => void> = [];

  let cachedCandidateIds: ReadonlyArray<string> | undefined;
  let cachedCandidateNodes: ReadonlyArray<Readonly<BoardNode<JsonValue>>> | undefined;
  let candidateCacheDirty = true;

  let cancelScheduled: (() => void) | undefined;
  let destroyed = false;

  const forwardWheel = options.wheelSurface
    ? (event: WheelEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        options.wheelSurface?.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        }));
      }
    : undefined;

  const boundsOf = (node: Readonly<BoardNode<JsonValue>>): WorldBounds =>
    resolveOverlayBounds(node, board.nodeTypes);

  const candidates = options.candidates ?? (() => board.visibleNodeIds());

  const candidateNodes = (): ReadonlyArray<Readonly<BoardNode<JsonValue>>> => {
    if (!candidateCacheDirty && cachedCandidateNodes) return cachedCandidateNodes;
    const ids = candidates();
    if (!ids) {
      cachedCandidateIds = undefined;
      cachedCandidateNodes = board.nodes.list();
      candidateCacheDirty = false;
      return cachedCandidateNodes;
    }

    const nextIds = [...ids];
    cachedCandidateIds = nextIds;
    cachedCandidateNodes = board.nodes.list({ ids: nextIds });
    candidateCacheDirty = false;
    return cachedCandidateNodes;
  };

  const acquire = (key: string): HTMLElement => {
    const existing = active.get(key);
    if (existing) return existing;
    const element = pool.pop() ?? document.createElement("div");
    element.className = itemClassName;
    element.style.position = "absolute";
    element.style.top = "0";
    element.style.left = "0";
    // Transform origin has to be the anchor point itself, otherwise a scaled
    // item drifts away from the node it belongs to as the zoom changes.
    element.style.transformOrigin = "0 0";
    if (forwardWheel) element.addEventListener("wheel", forwardWheel, { passive: false });
    options.container.appendChild(element);
    active.set(key, element);
    return element;
  };

  const release = (key: string, element: HTMLElement): void => {
    active.delete(key);
    element.remove();
    if (forwardWheel) element.removeEventListener("wheel", forwardWheel);
    element.removeAttribute("style");
    element.textContent = "";
    applied.delete(element);
    pool.push(element);
  };

  const flush = (): void => {
    if (destroyed) return;
    cancelScheduled = undefined;
    const viewport = board.viewport.get();
    const seen = new Set<string>();

    for (const node of candidateNodes()) {
      const item = options.item(node);
      if (!item) continue;
      const placement = projectOverlayItem(node, item, viewport, boundsOf(node));
      if (!placement) continue;

      seen.add(placement.key);
      const element = acquire(placement.key);
      const className = [itemClassName, placement.className, placement.collapsed ? collapsedClassName : undefined]
        .filter(Boolean)
        .join(" ");
      // translate3d keeps positioning out of the layout path. Avoiding an
      // unconditional write matters when several board events land together;
      // forcing every item into its own layer via will-change is deliberately
      // left to the host stylesheet because it can cost more than it saves.
      const transform =
        `translate3d(${placement.screen.x}px, ${placement.screen.y}px, 0)` +
        (placement.scale === 1 ? "" : ` scale(${placement.scale})`);
      const previous = applied.get(element);
      if (!previous || previous.className !== className) element.className = className;
      if (!previous || previous.transform !== transform) element.style.transform = transform;
      applied.set(element, { className, transform });
      options.render({ element, placement, node });
    }

    for (const [key, element] of active) if (!seen.has(key)) release(key, element);
    options.onFlush?.();
  };

  const scheduleRefresh = (): void => {
    if (destroyed || cancelScheduled) return;
    cancelScheduled = schedule(flush);
  };

  const refresh = (): void => {
    candidateCacheDirty = true;
    scheduleRefresh();
  };

  disposers.push(board.on("change", refresh));
  disposers.push(board.on("selection:change", refresh));
  // Panning/zooming changes projection and can also change the renderer's
  // visible set. Invalidate the candidate cache here; otherwise the scheduled
  // flush could keep rendering nodes from the previous viewport.
  disposers.push(board.on("viewport:change", refresh));
  // A rebuild can change what the renderer holds without touching the
  // document, so the visible-set-driven layers need this too.
  disposers.push(board.on("render:complete", refresh));
  flush();

  return {
    refresh,
    flush() {
      cancelScheduled?.();
      cancelScheduled = undefined;
      flush();
    },
    size: () => active.size,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelScheduled?.();
      cancelScheduled = undefined;
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      for (const [key, element] of active) release(key, element);
      pool.length = 0;
    },
  };
}

function defaultSchedule(callback: () => void): () => void {
  if (typeof requestAnimationFrame !== "function") {
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
  }
  const handle = requestAnimationFrame(() => callback());
  return () => cancelAnimationFrame(handle);
}
