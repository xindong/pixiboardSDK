import {
  GridSpatialIndex,
  defaultConnectionStyle,
  normalizeConnectionStyle,
  type ConnectionCurve,
  type ConnectionStyle,
} from "@pixi-board/renderer-pixi";
import { rotatedRectBounds } from "@pixi-board/core";
import type { BoardDocument, BoardNode, JsonValue, PixiBoard, Point } from "./types";

export type { ConnectionCurve, ConnectionStyle } from "@pixi-board/core";
export type BoardConnection = { id: string; source: string; target: string };
export type ConnectionsOptions = {
  surface: HTMLElement;
  overlay?: HTMLElement;
  enabled?: boolean;
  style?: Partial<ConnectionStyle>;
  /** Set false for host-owned preferences that must never enter document history. */
  persistSettings?: boolean;
  /** The host can restrict gestures to its current selection tool. */
  canInteract?: () => boolean;
  /** Native node media surfaces rendered outside the canvas element. */
  interactionOverlays?: readonly HTMLElement[];
};

type ConnectionSettings = { enabled?: boolean; style?: Partial<ConnectionStyle> };
type ConnectionDrag = { source: string; pointerId: number; point: Point };

const PREVIEW_ID = "__connection_preview__";
const PORT_OFFSET = 7;
const PORT_HOVER_RADIUS = 14;

/** Native Pixi connections, with one reusable DOM source port. */
export async function attachConnections(board: PixiBoard, options: ConnectionsOptions) {
  const layer = await board.createConnectionLayer();
  const surface = options.surface;
  const overlay = options.overlay ?? surface;
  const persistSettings = options.persistSettings !== false;
  const edges = new Map<string, BoardConnection>();
  const adjacent = new Map<string, Set<string>>();
  const incomingIndex = new Map<string, Set<string>>();
  const outgoingIndex = new Map<string, Set<string>>();
  const nodes = new Map<string, Readonly<BoardNode>>();
  const nodeIndex = new GridSpatialIndex();
  const dirty = new Set<string>();
  const cleanup: Array<() => void> = [];
  // Explicit host preferences remain authoritative across document loads.
  let enabledOverride = options.enabled;
  let styleOverride = { ...options.style };
  let enabled = options.enabled ?? false;
  let style = normalizeConnectionStyle({ ...defaultConnectionStyle, ...options.style });
  let selected: string | undefined;
  let hover: string | undefined;
  let drag: ConnectionDrag | undefined;
  let destroyed = false;
  let initialized = false;
  let frame = 0;
  let spacePressed = false;
  let ownsKeyboard = false;

  const port = document.createElement("button");
  port.type = "button";
  port.className = "pixiboard-connection-port";
  port.title = "拖动连接节点";
  port.setAttribute("aria-label", port.title);
  port.tabIndex = -1;
  port.style.cssText = [
    "position:absolute", "width:9px", "height:9px", "border-radius:50%",
    "border:1.5px solid white", "background:#6366f1", "box-shadow:0 1px 5px #0003",
    "transform:translate(-50%,-50%)", "padding:0", "cursor:crosshair",
    "pointer-events:auto", "touch-action:none", "display:none", "z-index:15",
  ].join(";");
  overlay.appendChild(port);

  const canInteract = () => !destroyed && enabled && !spacePressed && (options.canInteract?.() ?? true);
  const canConnect = (node: Readonly<BoardNode> | undefined): node is Readonly<BoardNode> =>
    !!node && node.visible !== false && node.locked !== true;
  const anchor = (node: Readonly<BoardNode>, right: boolean): Point => {
    const x = right ? node.width : 0;
    const y = node.height / 2;
    const c = Math.cos(node.rotation);
    const s = Math.sin(node.rotation);
    return { x: node.x + x * c - y * s, y: node.y + x * s + y * c };
  };
  const curve = (edge: BoardConnection): ConnectionCurve | undefined => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || source.visible === false || target.visible === false) return;
    return {
      id: edge.id,
      start: anchor(source, true),
      end: anchor(target, false),
      startDirection: { x: Math.cos(source.rotation), y: Math.sin(source.rotation) },
      endDirection: { x: Math.cos(target.rotation), y: Math.sin(target.rotation) },
    };
  };
  const portPosition = (node: Readonly<BoardNode>): Point => {
    const point = board.viewport.toScreen(anchor(node, true));
    const rect = surface.getBoundingClientRect();
    return { x: point.x + rect.left + PORT_OFFSET, y: point.y + rect.top };
  };
  const projectPort = () => {
    const node = hover ? nodes.get(hover) : undefined;
    port.style.display = canInteract() && canConnect(node) && !drag ? "block" : "none";
    if (!node) return;
    const point = portPosition(node);
    const rect = overlay.getBoundingClientRect();
    port.style.left = `${point.x - rect.left + overlay.scrollLeft}px`;
    port.style.top = `${point.y - rect.top + overlay.scrollTop}px`;
  };
  const flush = () => {
    frame = 0;
    if (destroyed) return;
    if (drag && (!canInteract() || !canConnect(nodes.get(drag.source)))) drag = undefined;
    for (const id of dirty) {
      const edge = edges.get(id);
      const value = edge && curve(edge);
      if (value) layer.upsert(value);
      else layer.remove(id);
    }
    dirty.clear();
    const source = drag && nodes.get(drag.source);
    if (drag && source) {
      layer.upsert({ id: PREVIEW_ID, start: anchor(source, true), end: drag.point });
    } else {
      layer.remove(PREVIEW_ID);
    }
    layer.setSelected(selected);
    projectPort();
  };
  const schedule = () => {
    if (!destroyed && !frame) frame = requestAnimationFrame(flush);
  };
  const cancelInteraction = () => {
    drag = undefined;
    hover = undefined;
    selected = undefined;
    schedule();
  };
  const rebuildNodes = () => {
    nodes.clear();
    nodeIndex.rebuild([]);
    for (const node of board.find()) {
      nodes.set(node.id, node);
      if (node.visible !== false) nodeIndex.insert({ id: node.id, ...rotatedRectBounds(node) });
    }
  };
  const readEdges = (): Map<string, BoardConnection> => {
    const result = new Map<string, BoardConnection>();
    const values = board.document.getMetadata()?.connections;
    for (const value of Array.isArray(values) ? values : []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const { id, source, target } = value;
      if (typeof id === "string" && typeof source === "string" && typeof target === "string") {
        result.set(id, { id, source, target });
      }
    }
    return result;
  };
  const addToIndex = (index: Map<string, Set<string>>, nodeId: string, edgeId: string) => {
    let ids = index.get(nodeId);
    if (!ids) index.set(nodeId, ids = new Set());
    ids.add(edgeId);
  };
  const synchronize = () => {
    const settings = persistSettings
      ? board.document.getMetadata()?.connectionSettings as ConnectionSettings | undefined
      : undefined;
    const nextEnabled = enabledOverride ?? settings?.enabled ?? false;
    const nextStyle = normalizeConnectionStyle({
      ...defaultConnectionStyle,
      ...settings?.style,
      ...styleOverride,
    });
    if (!initialized || JSON.stringify(style) !== JSON.stringify(nextStyle)) layer.setStyle(nextStyle);
    if (!initialized || enabled !== nextEnabled) layer.setEnabled(nextEnabled);
    enabled = nextEnabled;
    style = nextStyle;
    initialized = true;

    const next = readEdges();
    for (const id of edges.keys()) {
      if (next.has(id)) continue;
      layer.remove(id);
      if (selected === id) selected = undefined;
    }
    adjacent.clear();
    incomingIndex.clear();
    outgoingIndex.clear();
    for (const [id, edge] of next) {
      const previous = edges.get(id);
      if (!previous || previous.source !== edge.source || previous.target !== edge.target) dirty.add(id);
      addToIndex(adjacent, edge.source, id);
      addToIndex(adjacent, edge.target, id);
      addToIndex(outgoingIndex, edge.source, id);
      addToIndex(incomingIndex, edge.target, id);
    }
    edges.clear();
    for (const [id, edge] of next) edges.set(id, edge);
    if (!enabled) cancelInteraction();
    schedule();
  };
  const write = (values: BoardConnection[]) => {
    board.document.patchMetadata({ connections: values as unknown as JsonValue });
    // Board change delivery can be deferred; keep consecutive API calls consistent.
    synchronize();
  };
  const create = (source: string, target: string): BoardConnection | undefined => {
    if (destroyed || source === target || !canConnect(board.nodes.get(source)) || !canConnect(board.nodes.get(target))) return;
    const current = readEdges();
    for (const edge of current.values()) {
      if (edge.source === source && edge.target === target) return { ...edge };
    }
    const edge = { id: crypto.randomUUID(), source, target };
    write([...current.values(), edge]);
    return { ...edge };
  };
  const remove = (id: string) => {
    if (destroyed) return;
    const current = readEdges();
    if (current.delete(id)) write([...current.values()]);
  };
  const indexedEdges = (index: Map<string, Set<string>>, nodeId: string): BoardConnection[] => {
    const result: BoardConnection[] = [];
    for (const id of index.get(nodeId) ?? []) {
      const edge = edges.get(id);
      if (edge) result.push({ ...edge });
    }
    return result;
  };

  const screen = (event: PointerEvent): Point => {
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const withinSurface = (event: PointerEvent) => {
    const rect = surface.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  const isCanvasTarget = (target: EventTarget | null) =>
    target === port || (target instanceof Element &&
      (surface.contains(target) || options.interactionOverlays?.some(overlay => overlay.contains(target))) &&
      !target.closest("button,input,textarea,select,[contenteditable]:not([contenteditable=false])"));
  const hasModifiers = (event: PointerEvent) => event.altKey || event.shiftKey || event.ctrlKey || event.metaKey;
  const hitNode = (point: Point): Readonly<BoardNode> | undefined => {
    let found: Readonly<BoardNode> | undefined;
    for (const id of nodeIndex.queryPoint(point)) {
      const node = nodes.get(id);
      if (!node || node.visible === false) continue;
      const c = Math.cos(node.rotation);
      const s = Math.sin(node.rotation);
      const dx = point.x - node.x;
      const dy = point.y - node.y;
      const x = dx * c + dy * s;
      const y = -dx * s + dy * c;
      if (x >= 0 && x <= node.width && y >= 0 && y <= node.height && (!found || node.zIndex >= found.zIndex)) found = node;
    }
    return found;
  };
  const listen = <E extends Event>(target: EventTarget, name: string, handler: (event: E) => void, capture = false) => {
    const listener = handler as EventListener;
    target.addEventListener(name, listener, capture);
    cleanup.push(() => target.removeEventListener(name, listener, capture));
  };

  listen<PointerEvent>(port, "pointerdown", event => {
    if (event.defaultPrevented || !canInteract() || !withinSurface(event) || !hover || event.button !== 0 || hasModifiers(event)) return;
    if (!canConnect(nodes.get(hover))) return;
    event.preventDefault();
    // Only the dedicated port owns this gesture. Never block other SDK listeners
    // with stopImmediatePropagation on the canvas or window.
    event.stopPropagation();
    board.focus();
    ownsKeyboard = true;
    drag = { source: hover, pointerId: event.pointerId, point: board.viewport.toWorld(screen(event)) };
    selected = undefined;
    schedule();
  });
  listen<PointerEvent>(window, "pointermove", event => {
    if (drag && drag.pointerId !== event.pointerId) return;
    if (!canInteract() || !withinSurface(event)) {
      drag = undefined;
      hover = undefined;
      schedule();
      return;
    }
    if (drag) {
      if (!canConnect(nodes.get(drag.source))) drag = undefined;
      else drag.point = board.viewport.toWorld(screen(event));
      schedule();
      return;
    }
    if (event.buttons || hasModifiers(event) || !isCanvasTarget(event.target)) {
      hover = undefined;
      schedule();
      return;
    }
    const hovered = hover ? nodes.get(hover) : undefined;
    // Bridge the 7px gap between the node edge and the source port in screen pixels.
    const point = hovered && canConnect(hovered) ? portPosition(hovered) : undefined;
    const nearPort = point && Math.hypot(event.clientX - point.x, event.clientY - point.y) <= PORT_HOVER_RADIUS;
    if (!nearPort) {
      const node = hitNode(board.viewport.toWorld(screen(event)));
      hover = canConnect(node) ? node.id : undefined;
    }
    schedule();
  });
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const source = drag.source;
    drag = undefined;
    if (event.type === "pointerup" && canInteract() && withinSurface(event) && isCanvasTarget(event.target) && !hasModifiers(event)) {
      const target = hitNode(board.viewport.toWorld(screen(event)));
      if (canConnect(target)) create(source, target.id);
    }
    schedule();
  };
  listen<PointerEvent>(window, "pointerup", finish);
  listen<PointerEvent>(window, "pointercancel", finish);
  listen<PointerEvent>(window, "pointerdown", event => {
    const inside = withinSurface(event) && isCanvasTarget(event.target);
    ownsKeyboard = inside;
    if (!inside) cancelInteraction();
  }, true);
  // A hit edge owns the gesture before the host starts a blank-canvas marquee.
  // Node and empty-space events continue to the host's selection/pan handlers.
  listen<PointerEvent>(surface, "pointerdown", event => {
    if (event.target === port) return;
    if (event.defaultPrevented || !canInteract() || !withinSurface(event) || !isCanvasTarget(event.target) || event.button !== 0 || hasModifiers(event)) {
      cancelInteraction();
      return;
    }
    const point = board.viewport.toWorld(screen(event));
    selected = hitNode(point) ? undefined : layer.hitTest(point, 7 / board.viewport.get().scale);
    if (selected) {
      board.focus();
      board.selection.clear();
      event.preventDefault();
      event.stopPropagation();
    }
    schedule();
  }, true);
  listen<KeyboardEvent>(window, "keydown", event => {
    const element = event.target instanceof Element ? event.target : undefined;
    if (element?.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return;
    if (event.code === "Space") {
      spacePressed = true;
      cancelInteraction();
      return;
    }
    if (!ownsKeyboard) return;
    if (event.key === "Escape") cancelInteraction();
    if (canInteract() && selected && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      remove(selected);
      selected = undefined;
      schedule();
    }
  }, true);
  listen<KeyboardEvent>(window, "keyup", event => {
    if (event.code === "Space") {
      spacePressed = false;
      schedule();
    }
  });
  listen<FocusEvent>(window, "focusin", event => {
    const target = event.target;
    if (target instanceof Node && !surface.contains(target) && target !== port) {
      ownsKeyboard = false;
      cancelInteraction();
    }
  });
  listen(window, "blur", () => {
    spacePressed = false;
    ownsKeyboard = false;
    cancelInteraction();
  });

  rebuildNodes();
  synchronize();
  cleanup.push(board.on("change", event => {
    if (event.changeSet.origin === "load") {
      cancelInteraction();
      rebuildNodes();
      synchronize();
      for (const id of edges.keys()) dirty.add(id);
      schedule();
      return;
    }
    for (const id of event.changeSet.removedNodeIds) {
      nodes.delete(id);
      nodeIndex.remove(id);
      for (const edgeId of adjacent.get(id) ?? []) dirty.add(edgeId);
    }
    for (const node of event.documentUpdate.changedNodes) {
      nodes.set(node.id, node);
      if (node.visible === false) nodeIndex.remove(node.id);
      else nodeIndex.update({ id: node.id, ...rotatedRectBounds(node) });
      for (const id of adjacent.get(node.id) ?? []) dirty.add(id);
    }
    if (event.changeSet.metadataChanged) synchronize();
    schedule();
  }));
  cleanup.push(board.on("viewport:change", projectPort));
  cleanup.push(board.selection.onChange(() => {
    if (board.selection.get().length) {
      selected = undefined;
      schedule();
    }
  }));

  const saveSettings = () => {
    if (persistSettings) {
      board.document.patchMetadata({ connectionSettings: { enabled, style } as unknown as JsonValue });
    }
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(frame);
    for (const dispose of cleanup) dispose();
    port.remove();
    layer.destroy();
  };
  board.signal.addEventListener("abort", destroy, { once: true });
  cleanup.push(() => board.signal.removeEventListener("abort", destroy));
  if (board.signal.aborted) destroy();

  return {
    setEnabled(value: boolean) {
      if (destroyed) return;
      enabledOverride = value;
      enabled = value;
      layer.setEnabled(enabled);
      if (!enabled) cancelInteraction();
      saveSettings();
      schedule();
    },
    setStyle(value: Partial<ConnectionStyle>) {
      if (destroyed) return;
      style = normalizeConnectionStyle({ ...style, ...value });
      styleOverride = { ...styleOverride, ...value };
      layer.setStyle(style);
      saveSettings();
    },
    getStyle: () => ({ ...style }),
    isEnabled: () => enabled,
    list: () => [...edges.values()].map(edge => ({ ...edge })),
    /** Copies only internal edges, independently of the rendering preference. */
    copyWithin(nodeIds: Iterable<string>): BoardConnection[] {
      const included = new Set(nodeIds);
      return [...readEdges().values()]
        .filter(edge => included.has(edge.source) && included.has(edge.target))
        .map(edge => ({ ...edge }));
    },
    /** Call inside the node-paste transaction to undo nodes and edges together. */
    pasteWithin(connections: readonly BoardConnection[], idMap: ReadonlyMap<string, string>): void {
      if (destroyed) return;
      board.transaction("Paste connections", () => {
        const current = readEdges();
        const pairs = new Set([...current.values()].map(edge => JSON.stringify([edge.source, edge.target])));
        const pasted: BoardConnection[] = [];
        for (const connection of connections) {
          const source = idMap.get(connection.source);
          const target = idMap.get(connection.target);
          if (source === undefined || target === undefined || source === target) continue;
          if (!board.nodes.get(source) || !board.nodes.get(target)) continue;
          const pair = JSON.stringify([source, target]);
          if (pairs.has(pair)) continue;
          pairs.add(pair);
          pasted.push({ id: crypto.randomUUID(), source, target });
        }
        if (pasted.length) write([...current.values(), ...pasted]);
      });
    },
    /** Stored relationships remain queryable even when rendering is disabled. */
    incoming: (nodeId: string) => indexedEdges(incomingIndex, nodeId),
    outgoing: (nodeId: string) => indexedEdges(outgoingIndex, nodeId),
    /** Agent context follows the host's preference and requested edge direction. */
    getNeighborIds(nodeId: string, direction: "incoming" | "outgoing"): string[] {
      if (!enabled) return [];
      const index = direction === "incoming" ? incomingIndex : outgoingIndex;
      const neighbors = new Set<string>();
      for (const id of index.get(nodeId) ?? []) {
        const edge = edges.get(id);
        if (edge) neighbors.add(direction === "incoming" ? edge.source : edge.target);
      }
      return [...neighbors];
    },
    create,
    remove,
    destroy,
  };
}

export type ConnectionsController = Awaited<ReturnType<typeof attachConnections>>;
