import "./styles.css";
import {
  createPixiBoard,
  type CustomDisplayObject,
  type CustomNodeDefinition,
  type NodeHandle,
  type PixiBoard,
  type RuntimeRenderer,
} from "pixiboardjs";
import { NodeTypeRegistry } from "@pixi-board/core";
import { createPixiApplicationFactory, PixiBoardRenderer } from "@pixi-board/renderer-pixi";

const host = document.querySelector<HTMLDivElement>("#board-host")!;
const hudNodes = document.querySelector<HTMLSpanElement>("#hud-nodes")!;
const hudSelection = document.querySelector<HTMLSpanElement>("#hud-selection")!;
const hudScale = document.querySelector<HTMLSpanElement>("#hud-scale")!;
const hudFps = document.querySelector<HTMLSpanElement>("#hud-fps")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;
const selectionBox = document.querySelector<HTMLDivElement>("#selection-box")!;
const infoPanel = document.querySelector<HTMLDivElement>("#info-panel")!;
const infoToggle = document.querySelector<HTMLButtonElement>("#info-toggle")!;
const infoClose = document.querySelector<HTMLButtonElement>("#info-close")!;

let activeBoard: PixiBoard | undefined;

type StageLike = {
  scale: { set(x: number, y: number): void };
  position: { set(x: number, y: number): void };
};

type RectProps = { fill: number };
type TextProps = { text: string; style?: Record<string, string | number | boolean | null> };

const rectTypeDefinition: CustomNodeDefinition<RectProps> = {
  type: "rect",
  version: 1,
  defaults: { fill: 0x7c8cf8 },
  validate(value): RectProps {
    const candidate = (value ?? {}) as Partial<RectProps>;
    return { fill: typeof candidate.fill === "number" ? candidate.fill : 0x7c8cf8 };
  },
  getBounds(node) {
    return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
  },
};

const textTypeDefinition: CustomNodeDefinition<TextProps> = {
  type: "text",
  version: 1,
  defaults: { text: "" },
  validate(value): TextProps {
    const candidate = (value ?? {}) as Partial<TextProps>;
    return {
      text: typeof candidate.text === "string" ? candidate.text : "",
      ...(candidate.style ? { style: candidate.style } : {}),
    };
  },
  getBounds(node) {
    return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
  },
};

type TaskCardProps = { title: string; status: "todo" | "doing" | "done" };

const STATUS_COLOR: Record<TaskCardProps["status"], number> = {
  todo: 0x667487,
  doing: 0xf6b73c,
  done: 0x52d68e,
};

type TaskCardViewState = { body: CustomDisplayObject | undefined; label: CustomDisplayObject | undefined };

const taskCardDefinition: CustomNodeDefinition<TaskCardProps, TaskCardViewState> = {
  type: "demo.task-card",
  version: 1,
  defaults: { title: "New task", status: "todo" },
  validate(value): TaskCardProps {
    const candidate = (value ?? {}) as Partial<TaskCardProps>;
    const status: TaskCardProps["status"] =
      candidate.status === "doing" || candidate.status === "done" ? candidate.status : "todo";
    return { title: typeof candidate.title === "string" ? candidate.title : "New task", status };
  },
  getBounds(node) {
    return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
  },
  renderer: {
    create(node, context) {
      const displayObject = context.display.createContainer();
      const body = context.display.createRect?.(node.width, node.height, STATUS_COLOR[node.props.status]);
      const label = context.display.createText?.(node.props.title, { fill: 0x0a0d12, fontSize: 14, fontWeight: "600" });
      if (body) displayObject.addChild?.(body);
      if (label) {
        label.x = 12;
        label.y = node.height / 2 - 8;
        displayObject.addChild?.(label);
      }
      return { displayObject, state: { body, label } };
    },
    update(view, node) {
      view.displayObject.x = node.x;
      view.displayObject.y = node.y;
      view.displayObject.rotation = node.rotation;
      view.displayObject.zIndex = node.zIndex;
      if (view.state.label) view.state.label.text = node.props.title;
      const body = view.state.body as (CustomDisplayObject & { clear?(): CustomDisplayObject; rect?(x: number, y: number, w: number, h: number): CustomDisplayObject & { fill?(color: number): void }; }) | undefined;
      if (body?.clear) {
        body.clear();
        body.rect?.(0, 0, node.width, node.height).fill?.(STATUS_COLOR[node.props.status]);
      }
    },
    destroy(view) {
      view.displayObject.destroy?.({ children: true });
    },
  },
};

const NEXT_STATUS: Record<TaskCardProps["status"], TaskCardProps["status"]> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

const RECT_COLORS = [0x7c8cf8, 0x52d68e, 0xf6b73c, 0xf16c8c, 0x4ecbe0];
let colorCursor = 0;
let seedCounter = 0;

function seededDocument() {
  return {
    schemaVersion: 1,
    revision: 0,
    assets: [],
    nodes: [
      node("hero-rect", "rect", 80, 90, 180, 110, { fill: 0x7c8cf8 }),
      node("hero-text", "text", 320, 100, 220, 40, { text: "拖拽我 → 移动节点", style: { fill: 0xe8edf4, fontSize: 18 } }),
      node("hero-card-1", "demo.task-card", 80, 260, 200, 64, { title: "设计 API 契约", status: "done" }),
      node("hero-card-2", "demo.task-card", 320, 260, 200, 64, { title: "实现渲染器", status: "doing" }),
      node("hero-card-3", "demo.task-card", 560, 260, 200, 64, { title: "撰写文档", status: "todo" }),
    ],
  };
}

function node(
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  props: Record<string, unknown>,
) {
  return { id, type, typeVersion: 1, x, y, width, height, rotation: 0, zIndex: 0, props };
}

async function main(): Promise<void> {
  let application: { canvas: HTMLCanvasElement; stage: StageLike } | undefined;
  const applicationFactory = createPixiApplicationFactory({
    resizeTo: host,
    antialias: true,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  const nodeTypes = new NodeTypeRegistry();
  nodeTypes.register(rectTypeDefinition);
  nodeTypes.register(textTypeDefinition);

  const board = await createPixiBoard({
    container: host,
    document: seededDocument(),
    core: { nodeTypes },
    interactions: { pointer: true, keyboard: true },
    ports: {
      events: window,
      onKeyboardEvent: (event) => handleKeyboard(event as KeyboardEvent),
      createResizeObserver: (callback) => new ResizeObserver(callback),
    },
    rendererFactory: (options) =>
      new PixiBoardRenderer({
        ...(options as Record<string, unknown>),
        applicationFactory: async () => {
          const app = await applicationFactory();
          application = app as never;
          return app;
        },
      } as ConstructorParameters<typeof PixiBoardRenderer>[0]) as unknown as RuntimeRenderer,
  });
  await board.ready;
  if (application) host.appendChild(application.canvas);
  await board.nodeTypes.register(taskCardDefinition);

  activeBoard = board;
  wireStageTransform(board, application);
  wireToolbar(board);
  wirePointerInteractions(board);
  wireInfoPanel();
  wireHud(board);

  window.addEventListener("resize", () => {
    board.viewport.fitBounds(padBounds(computeContentBounds(board), 80));
  });

  board.viewport.fitBounds(padBounds(computeContentBounds(board), 80));
}

// The renderer keeps node positions in raw world/document units on an
// untransformed Pixi container; the SDK's viewport (scale/offset) is state
// the host application is responsible for projecting onto the real stage.
function wireStageTransform(board: PixiBoard, application: { stage: StageLike } | undefined): void {
  if (!application) return;
  const apply = () => {
    const viewport = board.viewport.get();
    application.stage.scale.set(viewport.scale, viewport.scale);
    application.stage.position.set(viewport.offset.x, viewport.offset.y);
  };
  board.on("viewport:change", apply);
  apply();
}

function computeContentBounds(board: PixiBoard) {
  const nodes = board.find();
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of nodes) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  return { minX, minY, maxX, maxY };
}

function padBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, padding: number) {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

function wireInfoPanel(): void {
  const setOpen = (open: boolean) => {
    infoPanel.classList.toggle("open", open);
    infoToggle.setAttribute("aria-expanded", String(open));
  };
  infoToggle.addEventListener("click", () => setOpen(!infoPanel.classList.contains("open")));
  infoClose.addEventListener("click", () => setOpen(false));
}

function wireToolbar(board: PixiBoard): void {
  toolbar.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const centerWorld = board.viewport.toWorld({ x: host.clientWidth / 2, y: host.clientHeight / 2 });
    switch (action) {
      case "add-rect": {
        const fill = RECT_COLORS[colorCursor++ % RECT_COLORS.length];
        board.nodes.create({
          type: "rect",
          x: centerWorld.x - 60 + (seedCounter % 5) * 14,
          y: centerWorld.y - 40 + (seedCounter % 5) * 14,
          width: 120,
          height: 80,
          props: { fill },
        });
        seedCounter += 1;
        break;
      }
      case "add-text": {
        board.nodes.create({
          type: "text",
          x: centerWorld.x - 80,
          y: centerWorld.y,
          width: 200,
          height: 32,
          props: { text: "新文本节点", style: { fill: 0xe8edf4, fontSize: 16 } },
        });
        break;
      }
      case "add-card": {
        board.nodes.create<TaskCardProps>({
          type: "demo.task-card",
          x: centerWorld.x - 100,
          y: centerWorld.y - 32,
          width: 200,
          height: 64,
          props: { title: "自定义节点示例", status: "todo" },
        });
        break;
      }
      case "undo":
        board.history.undo();
        break;
      case "redo":
        board.history.redo();
        break;
      case "fit":
        board.viewport.fitBounds(padBounds(computeContentBounds(board), 80));
        break;
      case "reset":
        void board.document.load(seededDocument());
        break;
      case "export":
        exportDocument(board);
        break;
      default:
        break;
    }
  });
}

function exportDocument(board: PixiBoard): void {
  const json = JSON.stringify(board.document.toJSON(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pixiboard-demo-document.json";
  link.click();
  URL.revokeObjectURL(url);
}

function wirePointerInteractions(board: PixiBoard): void {
  let mode: "idle" | "select" | "drag-node" = "idle";
  let dragHandle: NodeHandle | undefined;
  let lastScreen = { x: 0, y: 0 };
  let dragOrigin = { x: 0, y: 0 };
  let selectStart = { x: 0, y: 0 };
  let lastTapNodeId: string | undefined;
  let lastTapTime = 0;

  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    board.focus();
    host.setPointerCapture(event.pointerId);
    const screenPoint = toHostPoint(event);
    const worldPoint = board.viewport.toWorld(screenPoint);
    const hitId = hitTestTopmost(board, worldPoint);
    lastScreen = screenPoint;

    if (hitId) {
      const now = performance.now();
      if (hitId === lastTapNodeId && now - lastTapTime < 320) {
        toggleTaskCardStatus(board, hitId);
        lastTapNodeId = undefined;
        return;
      }
      lastTapNodeId = hitId;
      lastTapTime = now;

      if (!board.selection.get().includes(hitId)) board.selection.set([hitId]);
      mode = "drag-node";
      dragHandle = board.node(hitId);
      const currentNode = board.nodes.get(hitId)!;
      dragOrigin = { x: currentNode.x, y: currentNode.y };
    } else {
      lastTapNodeId = undefined;
      board.selection.clear();
      mode = "select";
      selectStart = screenPoint;
      showSelectionBox(selectStart, selectStart);
    }
  });

  host.addEventListener("pointermove", (event) => {
    if (mode === "idle") return;
    const screenPoint = toHostPoint(event);
    const deltaScreen = { x: screenPoint.x - lastScreen.x, y: screenPoint.y - lastScreen.y };
    lastScreen = screenPoint;

    if (mode === "select") {
      showSelectionBox(selectStart, screenPoint);
    } else if (mode === "drag-node" && dragHandle) {
      const scale = board.viewport.get().scale;
      dragOrigin = { x: dragOrigin.x + deltaScreen.x / scale, y: dragOrigin.y + deltaScreen.y / scale };
      dragHandle.setAttrs({ x: dragOrigin.x, y: dragOrigin.y });
    }
  });

  const endDrag = (event: PointerEvent) => {
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    if (mode === "select") {
      const ids = nodesInScreenRect(board, selectStart, lastScreen);
      board.selection.set(ids);
      hideSelectionBox();
    }
    mode = "idle";
    dragHandle = undefined;
  };
  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);

  host.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const screenPoint = toHostPoint(event);
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinch synthesizes a wheel event with ctrlKey=true; explicit
        // Ctrl/Cmd + wheel follows the same zoom-at-pointer convention.
        const factor = Math.exp(-event.deltaY * 0.01);
        board.viewport.zoomAt(screenPoint, factor);
      } else {
        // Plain wheel scroll and two-finger trackpad pan both land here.
        board.viewport.panBy(-event.deltaX, -event.deltaY);
      }
    },
    { passive: false },
  );
}

function showSelectionBox(start: { x: number; y: number }, end: { x: number; y: number }): void {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
  selectionBox.hidden = false;
}

function hideSelectionBox(): void {
  selectionBox.hidden = true;
}

function nodesInScreenRect(board: PixiBoard, start: { x: number; y: number }, end: { x: number; y: number }): string[] {
  const worldStart = board.viewport.toWorld(start);
  const worldEnd = board.viewport.toWorld(end);
  const minX = Math.min(worldStart.x, worldEnd.x);
  const minY = Math.min(worldStart.y, worldEnd.y);
  const maxX = Math.max(worldStart.x, worldEnd.x);
  const maxY = Math.max(worldStart.y, worldEnd.y);
  return board
    .find()
    .filter((item) => item.x < maxX && item.x + item.width > minX && item.y < maxY && item.y + item.height > minY)
    .map((item) => item.id);
}

function handleKeyboard(event: KeyboardEvent): void {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
  const boardInstance = activeBoard;
  if (!boardInstance) return;
  for (const id of boardInstance.selection.get()) boardInstance.nodes.remove(id);
}

function toggleTaskCardStatus(board: PixiBoard, nodeId: string): void {
  const node = board.nodes.get<TaskCardProps>(nodeId);
  if (!node || node.type !== "demo.task-card") return;
  board.nodes.update<TaskCardProps>(nodeId, { props: { ...node.props, status: NEXT_STATUS[node.props.status] } });
}

function hitTestTopmost(board: PixiBoard, worldPoint: { x: number; y: number }): string | undefined {
  const candidates = board
    .find()
    .filter((item) => worldPoint.x >= item.x && worldPoint.x <= item.x + item.width && worldPoint.y >= item.y && worldPoint.y <= item.y + item.height)
    .sort((a, b) => b.zIndex - a.zIndex);
  return candidates[0]?.id;
}

function toHostPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = host.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function wireHud(board: PixiBoard): void {
  const refresh = () => {
    hudNodes.textContent = String(board.find().length);
    hudSelection.textContent = String(board.selection.get().length);
    hudScale.textContent = `${Math.round(board.viewport.get().scale * 100)}%`;
  };
  board.on("change", refresh);
  board.on("selection:change", refresh);
  board.on("viewport:change", refresh);
  refresh();

  let frames = 0;
  let lastSample = performance.now();
  const tick = () => {
    frames += 1;
    const now = performance.now();
    if (now - lastSample >= 1000) {
      hudFps.textContent = String(frames);
      frames = 0;
      lastSample = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main()
  .then(() => undefined)
  .catch((error) => {
    host.innerHTML = `<div class="boot-error">Demo failed to start: ${String(error)}</div>`;
    console.error(error);
  });
