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
  const disposers: Array<() => void> = [];

  let cancelScheduled: (() => void) | undefined;
  let destroyed = false;

  const boundsOf = (node: Readonly<BoardNode<JsonValue>>): WorldBounds =>
    resolveOverlayBounds(node, board.nodeTypes);

  const candidates = options.candidates ?? (() => board.visibleNodeIds());

  const candidateNodes = (): ReadonlyArray<Readonly<BoardNode<JsonValue>>> => {
    const ids = candidates();
    if (!ids) return board.nodes.list();
    const nodes: Array<Readonly<BoardNode<JsonValue>>> = [];
    for (const id of ids) {
      const node = board.nodes.get(id);
      if (node) nodes.push(node);
    }
    return nodes;
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
    element.style.willChange = "transform";
    options.container.appendChild(element);
    active.set(key, element);
    return element;
  };

  const release = (key: string, element: HTMLElement): void => {
    active.delete(key);
    element.remove();
    element.removeAttribute("style");
    element.textContent = "";
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
      element.className = [itemClassName, placement.className, placement.collapsed ? collapsedClassName : undefined]
        .filter(Boolean)
        .join(" ");
      // translate3d rather than translate: it keeps the item on its own
      // compositor layer, so a pan never repaints the elements themselves.
      element.style.transform =
        `translate3d(${placement.screen.x}px, ${placement.screen.y}px, 0)` +
        (placement.scale === 1 ? "" : ` scale(${placement.scale})`);
      options.render({ element, placement, node });
    }

    for (const [key, element] of [...active]) if (!seen.has(key)) release(key, element);
    options.onFlush?.();
  };

  const refresh = (): void => {
    if (destroyed || cancelScheduled) return;
    cancelScheduled = schedule(flush);
  };

  for (const event of ["change", "viewport:change", "selection:change"] as const) {
    disposers.push(board.on(event, refresh));
  }
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
      for (const [key, element] of [...active]) release(key, element);
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
