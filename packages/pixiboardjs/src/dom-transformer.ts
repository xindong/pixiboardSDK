import type { PixiBoard, Point, ResizeHandle, TransformSession } from "./types";

export type DomTransformerOptions = {
  /**
   * Where the handle elements are appended. Must be positioned (the overlay is
   * absolutely positioned inside it) and should sit above the canvas.
   */
  overlay: HTMLElement;
  /**
   * Element the pointer coordinates are measured against — normally the same
   * element the canvas fills, so screen points match `viewport.toScreen()`.
   * Defaults to `overlay`.
   */
  surface?: HTMLElement;
  /** Handle size in CSS pixels. */
  size?: number;
  /** Prefix for the generated class names; see `attachDomTransformer` docs. */
  classPrefix?: string;
};

export type DomTransformer = {
  /** Re-projects the handles. Call on selection, document and viewport change. */
  refresh(): void;
  /** True while a handle drag is in flight. */
  dragging(): boolean;
  destroy(): void;
};

const DEFAULT_SIZE = 9;

/**
 * Renders the eight resize control points as real DOM elements over the board
 * and drives `board.transform` from their pointer events.
 *
 * Handles must be real elements rather than CSS pseudo-elements: a pseudo
 * element is never an `event.target`, so it can be styled but never grabbed.
 * They also live in their own overlay with `pointer-events: auto` while the
 * rest of the overlay stays transparent to the pointer, so a drag that starts
 * on a handle never reaches the canvas's own select/drag handlers.
 *
 * Styling is left to the host: each handle carries
 * `<prefix>-handle` and `<prefix>-handle-<direction>` classes plus a
 * `data-handle` attribute, and only the properties this needs to work
 * (position, size, cursor, pointer-events) are set inline.
 */
export function attachDomTransformer(board: PixiBoard, options: DomTransformerOptions): DomTransformer {
  const surface = options.surface ?? options.overlay;
  const size = options.size ?? DEFAULT_SIZE;
  const prefix = options.classPrefix ?? "pixiboard";
  const elements = new Map<ResizeHandle, HTMLElement>();
  const disposers: Array<() => void> = [];

  let session: TransformSession | undefined;
  let sessionPointerId: number | undefined;
  let captureElement: HTMLElement | undefined;
  let startScreen: Point = { x: 0, y: 0 };

  const toSurfacePoint = (event: PointerEvent): Point => {
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const endSession = (mode: "commit" | "cancel") => {
    if (!session) return;
    const current = session;
    // Releasing the capture is not optional on every exit path: while a handle
    // holds it, every later pointer event in the document is retargeted to
    // that handle, so a gesture ended any way other than a plain pointerup
    // (Escape, destroy) would silently swallow the host's own canvas input
    // from then on.
    if (captureElement && sessionPointerId !== undefined && captureElement.hasPointerCapture(sessionPointerId)) {
      captureElement.releasePointerCapture(sessionPointerId);
    }
    session = undefined;
    sessionPointerId = undefined;
    captureElement = undefined;
    if (mode === "cancel") current.cancel();
    else current.commit();
    refresh();
  };

  const handleFor = (handle: ResizeHandle): HTMLElement => {
    const existing = elements.get(handle);
    if (existing) return existing;
    const element = document.createElement("div");
    element.className = `${prefix}-handle ${prefix}-handle-${handle}`;
    element.dataset.handle = handle;
    element.style.position = "absolute";
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.style.pointerEvents = "auto";
    element.style.touchAction = "none";
    element.style.boxSizing = "border-box";

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || session) return;
      // The canvas's own pointerdown would otherwise start a marquee or a node
      // drag under the handle.
      event.preventDefault();
      event.stopPropagation();
      const started = board.transform.begin(handle);
      if (!started) return;
      session = started;
      sessionPointerId = event.pointerId;
      captureElement = element;
      startScreen = toSurfacePoint(event);
      element.setPointerCapture(event.pointerId);
    };
    element.addEventListener("pointerdown", onPointerDown);
    disposers.push(() => element.removeEventListener("pointerdown", onPointerDown));

    const onPointerMove = (event: PointerEvent) => {
      if (!session || event.pointerId !== sessionPointerId) return;
      const screen = toSurfacePoint(event);
      // Convert both endpoints rather than scaling the screen delta: that also
      // stays correct if the viewport pans mid-gesture.
      const from = board.viewport.toWorld(startScreen);
      const to = board.viewport.toWorld(screen);
      session.update({ x: to.x - from.x, y: to.y - from.y });
      refresh();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== sessionPointerId) return;
      endSession("commit");
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== sessionPointerId) return;
      endSession("cancel");
    };
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
    disposers.push(() => {
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
    });

    elements.set(handle, element);
    options.overlay.appendChild(element);
    return element;
  };

  const refresh = () => {
    const placements = board.transform.handles();
    if (placements.length === 0) {
      for (const element of elements.values()) element.style.display = "none";
      return;
    }
    for (const placement of placements) {
      const element = handleFor(placement.handle);
      const screen = board.viewport.toScreen(placement.world);
      element.style.display = "";
      element.style.left = `${screen.x - size / 2}px`;
      element.style.top = `${screen.y - size / 2}px`;
      element.style.cursor = placement.cursor;
    }
  };

  // Escape aborts a gesture in flight, matching every other canvas editor.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && session) {
      event.preventDefault();
      endSession("cancel");
    }
  };
  window.addEventListener("keydown", onKeyDown);
  disposers.push(() => window.removeEventListener("keydown", onKeyDown));

  for (const event of ["selection:change", "change", "viewport:change"] as const) {
    disposers.push(board.on(event, refresh));
  }
  refresh();

  return {
    refresh,
    dragging: () => session !== undefined,
    destroy() {
      endSession("commit");
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      for (const element of elements.values()) element.remove();
      elements.clear();
    },
  };
}
