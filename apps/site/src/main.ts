import "./styles.css";
import {
  attachDomTransformer,
  createPixiBoard,
  type CustomDisplayObject,
  type CustomNodeDefinition,
  type DomTransformer,
  type PixiBoard,
  type RuntimeRenderer,
} from "pixiboardjs/browser";
import { NodeTypeRegistry, type AssetRef } from "@pixi-board/core";
import { createPixiApplicationFactory, loadPixiRuntime, PixiBoardRenderer } from "@pixi-board/renderer-pixi";
import {
  classifyMedia,
  MediaLibrary,
  UnsupportedMediaError,
  type AssetVariant,
  type MediaImport,
  type MediaKind,
} from "./media";

const host = document.querySelector<HTMLDivElement>("#board-host")!;
const hudNodes = document.querySelector<HTMLSpanElement>("#hud-nodes")!;
const hudSelection = document.querySelector<HTMLSpanElement>("#hud-selection")!;
const hudScale = document.querySelector<HTMLSpanElement>("#hud-scale")!;
const hudFps = document.querySelector<HTMLSpanElement>("#hud-fps")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;
const selectionBox = document.querySelector<HTMLDivElement>("#selection-box")!;
const selectionOverlay = document.querySelector<HTMLDivElement>("#selection-overlay")!;
const handleOverlay = document.querySelector<HTMLDivElement>("#handle-overlay")!;
const infoPanel = document.querySelector<HTMLDivElement>("#info-panel")!;
const infoToggle = document.querySelector<HTMLButtonElement>("#info-toggle")!;
const infoClose = document.querySelector<HTMLButtonElement>("#info-close")!;
const mediaInput = document.querySelector<HTMLInputElement>("#media-input")!;
const mediaOverlay = document.querySelector<HTMLDivElement>("#media-overlay")!;
const dropHint = document.querySelector<HTMLDivElement>("#drop-hint")!;
const toastHost = document.querySelector<HTMLDivElement>("#toast-host")!;

let activeBoard: PixiBoard | undefined;
const mediaLibrary = new MediaLibrary();

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

type MediaProps = { name: string; mimeType: string; size: number };

/**
 * The Pixi renderer already ships image/video/audio renderers that resolve
 * `assetRefs`; core ships no node types at all, so the host declares the data
 * side of those three types here.
 *
 * Images and video keep their aspect ratio when resized so media never
 * stretches; audio is a fixed-height waveform strip that only grows sideways,
 * which the custom policy below enforces.
 */
function mediaTypeDefinition(type: MediaKind): CustomNodeDefinition<MediaProps> {
  return {
    type,
    version: 1,
    defaults: { name: "", mimeType: "", size: 0 },
    resize: type === "audio"
      ? { mode: "custom", resize: ({ node, width }) => ({ width, height: node.height }) }
      : { mode: "aspect-ratio" },
    validate(value): MediaProps {
      const candidate = (value ?? {}) as Partial<MediaProps>;
      return {
        name: typeof candidate.name === "string" ? candidate.name : "",
        mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : "",
        size: typeof candidate.size === "number" ? candidate.size : 0,
      };
    },
    getBounds(node) {
      return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
    },
  };
}

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
  let application: { canvas: HTMLCanvasElement; stage: StageLike; render?(): void } | undefined;
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
  nodeTypes.register(mediaTypeDefinition("image"));
  nodeTypes.register(mediaTypeDefinition("video"));
  nodeTypes.register(mediaTypeDefinition("audio"));

  // A previously persisted board wins over the seeded scene so uploads survive
  // a reload; a corrupt record must not brick the demo.
  let restored: Awaited<ReturnType<MediaLibrary["loadDocument"]>>;
  try {
    restored = await mediaLibrary.loadDocument();
  } catch (error) {
    console.warn("Failed to restore the persisted document", error);
  }

  const board = await createPixiBoard({
    container: host,
    document: restored ?? seededDocument(),
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
        acquireTexture: (ref: AssetRef) => acquireMediaTexture(ref),
      } as ConstructorParameters<typeof PixiBoardRenderer>[0]) as unknown as RuntimeRenderer,
  });
  await board.ready;
  if (application) host.appendChild(application.canvas);
  await board.nodeTypes.register(taskCardDefinition);

  activeBoard = board;
  wireStageTransform(board, application);
  const transformer = wireSelectionOverlay(board);
  wirePointerInteractions(board, transformer);
  wireInfoPanel();
  wireHud(board);
  const resyncMediaBadges = wireMediaBadges(board);
  wireToolbar(board, resyncMediaBadges);
  wireMediaUpload(board, resyncMediaBadges);
  wirePersistence(board);

  // Fit once up front so the initial scene is centered. Later resizes must
  // NOT re-fit: the SDK already tracks `host`'s size via its own
  // ResizeObserver (packages/pixiboardjs) and Pixi's `resizeTo: host` keeps
  // the canvas pixel size in sync on its own — re-fitting here on every
  // resize would (a) race that ResizeObserver, since the native `window`
  // "resize" event fires synchronously while ResizeObserver callbacks are
  // always batched to a later frame, so fitBounds could read a stale screen
  // size, and (b) throw away whatever pan/zoom the user had set, snapping
  // back to "fit all" on every resize instead of just growing/shrinking the
  // visible area like an infinite canvas is expected to.
  board.viewport.fitBounds(padBounds(computeContentBounds(board), 80));
}

/**
 * Turns a document asset reference into a live Pixi texture. The renderer's
 * builtin media renderers call this; without it an image node resolves to an
 * empty sprite.
 */
async function acquireMediaTexture(ref: AssetRef): Promise<{ texture?: unknown; release?: () => void }> {
  // The reference carries its own variant, so no node lookup is needed. That
  // matters on restore: the first render pass runs before the board handle is
  // published, and guessing the variant there would hand a video's raw bytes
  // to the image decoder.
  const variant = (ref.variant ?? "original") as AssetVariant;
  const cacheKey = `${ref.assetId}:${variant}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return { texture: cached };

  const url = await mediaLibrary.objectUrl(ref.assetId, variant);
  if (!url) return {};

  try {
    // Decode to a bitmap first: Texture.from on a bare URL returns before the
    // pixels have loaded, which yields an empty sprite on first paint.
    const pixi = await loadPixiRuntime();
    const source = await decodeToBitmap(url);
    const texture = pixi.Texture?.from(source);
    if (texture === undefined) return {};
    textureCache.set(cacheKey, texture);
    return { texture };
  } catch (error) {
    // One unreadable asset must degrade to a placeholder node, never reject the
    // render pass and take the whole board down with it.
    console.warn(`Failed to decode asset ${ref.assetId} (${variant})`, error);
    return {};
  }
}

/** One GPU texture per asset variant; released wholesale when storage clears. */
const textureCache = new Map<string, unknown>();

async function decodeToBitmap(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(image);
    } catch {
      // Fall back to the decoded element itself.
    }
  }
  return image;
}

// The renderer keeps node positions in raw world/document units on an
// untransformed Pixi container; the SDK's viewport (scale/offset) is state
// the host application is responsible for projecting onto the real stage.
function wireStageTransform(
  board: PixiBoard,
  application: { stage: StageLike; render?(): void } | undefined,
): void {
  if (!application) return;
  const apply = () => {
    const viewport = board.viewport.get();
    application.stage.scale.set(viewport.scale, viewport.scale);
    application.stage.position.set(viewport.offset.x, viewport.offset.y);
    // The renderer only renders on demand when it drives a document change
    // (see PixiBoardRenderer.requestFrame); this stage transform is applied
    // directly by the host and bypasses that path entirely, so pan/zoom must
    // request its own frame or the canvas would freeze on the last document
    // render until something else invalidates it.
    application.render?.();
  };
  board.on("viewport:change", apply);
  apply();
}

// Selection outlines are host-drawn DOM, so they must be re-projected on every
// selection change, document change, and viewport change — a node can move
// under a static viewport and the viewport can move under a static selection.
// The eight resize handles are not drawn here: the SDK's DOM transformer owns
// them, because they need real elements with live pointer handlers rather than
// the decorative markup an outline can get away with.
function wireSelectionOverlay(board: PixiBoard): DomTransformer {
  const redraw = () => renderSelectionOverlay(board);
  board.on("selection:change", redraw);
  board.on("change", redraw);
  board.on("viewport:change", redraw);
  redraw();
  return attachDomTransformer(board, { overlay: handleOverlay, surface: host });
}

function renderSelectionOverlay(board: PixiBoard): void {
  const selected = board.selection
    .get()
    .map((id) => board.nodes.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  selectionOverlay.replaceChildren();
  if (selected.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of selected) {
    const topLeft = board.viewport.toScreen({ x: item.x, y: item.y });
    const bottomRight = board.viewport.toScreen({ x: item.x + item.width, y: item.y + item.height });
    minX = Math.min(minX, topLeft.x);
    minY = Math.min(minY, topLeft.y);
    maxX = Math.max(maxX, bottomRight.x);
    maxY = Math.max(maxY, bottomRight.y);

    const outline = document.createElement("div");
    outline.className = "selection-outline";
    outline.style.left = `${topLeft.x}px`;
    outline.style.top = `${topLeft.y}px`;
    outline.style.width = `${bottomRight.x - topLeft.x}px`;
    outline.style.height = `${bottomRight.y - topLeft.y}px`;
    selectionOverlay.appendChild(outline);
  }

  if (selected.length > 1) {
    const groupBox = document.createElement("div");
    groupBox.className = "selection-bbox";
    groupBox.style.left = `${minX - 6}px`;
    groupBox.style.top = `${minY - 6}px`;
    groupBox.style.width = `${maxX - minX + 12}px`;
    groupBox.style.height = `${maxY - minY + 12}px`;
    selectionOverlay.appendChild(groupBox);
  }
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

function wireToolbar(board: PixiBoard, resyncMediaBadges: () => void): void {
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
      case "upload":
        mediaInput.click();
        break;
      case "clear-storage":
        void clearStorage(board, resyncMediaBadges);
        break;
      default:
        break;
    }
  });
}

function wireMediaUpload(board: PixiBoard, resyncMediaBadges: () => void): void {
  mediaInput.addEventListener("change", () => {
    const files = [...(mediaInput.files ?? [])];
    // Reset first so re-picking the same file still fires a change event.
    mediaInput.value = "";
    if (files.length) void importFiles(board, files, freeSpaceAnchor(board), resyncMediaBadges);
  });

  // Only a drag that actually carries files should arm the drop affordance;
  // dragging a node inside the canvas must not flash the hint.
  let dragDepth = 0;
  const carriesFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");

  host.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropHint.hidden = false;
  });
  host.addEventListener("dragover", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  host.addEventListener("dragleave", (event) => {
    if (!carriesFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropHint.hidden = true;
  });
  host.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropHint.hidden = true;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    // Drop at the pointer, so files land where the user aimed them.
    void importFiles(board, files, board.viewport.toWorld(toHostPoint(event)), resyncMediaBadges);
  });
}

/**
 * Imports each file, laying the resulting nodes out in a row that grows into a
 * grid, anchored on the requested world point. Nodes are created one at a time
 * so a single bad file cannot abort the whole batch.
 */
async function importFiles(
  board: PixiBoard,
  files: File[],
  anchor: { x: number; y: number },
  resyncMediaBadges: () => void,
): Promise<void> {
  const supported = files.filter((file) => classifyMedia(file) !== undefined);
  const rejected = files.filter((file) => classifyMedia(file) === undefined);
  for (const file of rejected) {
    showToast(`不支持的文件类型：${file.name || file.type || "未知文件"}`, "error");
  }
  if (!supported.length) return;

  showToast(`正在处理 ${supported.length} 个文件…`);
  const created: MediaImport[] = [];
  let cursor = { x: anchor.x, y: anchor.y };
  let rowHeight = 0;
  let rowWidth = 0;

  for (const file of supported) {
    try {
      const media = await mediaLibrary.importFile(file);
      // Wrap the row once it grows past a comfortable width so a large batch
      // does not stretch off into empty space.
      if (rowWidth > 0 && rowWidth + media.width > 720) {
        cursor = { x: anchor.x, y: cursor.y + rowHeight + 16 };
        rowWidth = 0;
        rowHeight = 0;
      }
      await board.nodes.create<MediaProps>({
        type: media.kind,
        x: cursor.x + rowWidth,
        y: cursor.y,
        width: media.width,
        height: media.height,
        assetRefs: mediaAssetRefs(media),
        props: { name: media.name, mimeType: media.mimeType, size: media.size },
      });
      rowWidth += media.width + 16;
      rowHeight = Math.max(rowHeight, media.height);
      created.push(media);
    } catch (error) {
      const message = error instanceof UnsupportedMediaError
        ? error.message
        : `${file.name} 处理失败：${error instanceof Error ? error.message : String(error)}`;
      showToast(message, "error");
    }
  }

  if (created.length) {
    showToast(`已添加 ${created.length} 个媒体节点`, "success");
    resyncMediaBadges();
    // New media may land outside the current view; bring it into frame so the
    // upload visibly did something.
    board.viewport.fitBounds(padBounds(computeContentBounds(board), 80));
    void persist(board);
  }
}

/**
 * Points the reference at the variant each builtin renderer looks for: video
 * resolves a poster, audio a waveform, image a downscaled preview when one
 * was generated (builtins.ts checks "preview" before "primary", so this is
 * picked over the original automatically) and otherwise its original bytes.
 */
function mediaAssetRefs(media: MediaImport): Record<string, AssetRef> {
  if (media.kind === "video") return { poster: { assetId: media.assetId, variant: "preview" } };
  if (media.kind === "audio") return { waveform: { assetId: media.assetId, variant: "waveform" } };
  return {
    primary: { assetId: media.assetId, variant: "original" },
    ...(media.hasPreview ? { preview: { assetId: media.assetId, variant: "preview" } } : {}),
  };
}

/**
 * Where a toolbar upload should land. Dropping aims at the pointer, but the
 * button has no pointer to aim with, so new media is stacked under the existing
 * content instead of on top of it.
 */
function freeSpaceAnchor(board: PixiBoard): { x: number; y: number } {
  const bounds = computeContentBounds(board);
  return { x: bounds.minX, y: bounds.maxY + 48 };
}

type MediaBadgeInfo = { type: MediaKind; x: number; y: number; height: number; name: string };

/**
 * Labels each media node with its kind and file name. Media node state is
 * tracked incrementally from each changeSet's touched ids instead of calling
 * board.find() (a full-document deep clone) on every "change" event — a drag
 * on a large document would otherwise re-clone every node once per frame even
 * though only a handful of ids ever change.
 */
function wireMediaBadges(board: PixiBoard): () => void {
  const mediaNodes = new Map<string, MediaBadgeInfo>();
  const collect = () => {
    mediaNodes.clear();
    for (const node of board.find({ types: ["image", "video", "audio"] })) {
      mediaNodes.set(node.id, mediaBadgeInfo(node));
    }
  };
  collect();

  const redraw = () => renderMediaBadges(board, mediaNodes);

  board.on("change", (event) => {
    for (const id of event.changeSet.removedNodeIds) mediaNodes.delete(id);
    for (const id of [...event.changeSet.addedNodeIds, ...event.changeSet.updatedNodeIds]) {
      const node = board.nodes.get(id);
      if (node && isMediaKind(node.type)) mediaNodes.set(id, mediaBadgeInfo(node));
      else mediaNodes.delete(id);
    }
    redraw();
  });
  board.on("viewport:change", redraw);
  redraw();

  // The SDK applies "change" asynchronously (queued behind the renderer
  // apply pass), so a caller that just made a synchronous edit and wants the
  // badges to reflect it immediately — rather than a tick later — can force
  // a resync from the document instead of waiting for that event.
  return () => {
    collect();
    redraw();
  };
}

const KIND_ICON: Record<MediaKind, string> = { image: "🖼", video: "🎬", audio: "🎵" };

function isMediaKind(type: string): type is MediaKind {
  return type === "image" || type === "video" || type === "audio";
}

function mediaBadgeInfo(node: { type: string; x: number; y: number; height: number; props: unknown }): MediaBadgeInfo {
  const props = node.props as Partial<MediaProps>;
  return {
    type: node.type as MediaKind,
    x: node.x,
    y: node.y + node.height,
    height: node.height,
    name: typeof props.name === "string" && props.name ? props.name : node.type,
  };
}

function renderMediaBadges(board: PixiBoard, mediaNodes: ReadonlyMap<string, MediaBadgeInfo>): void {
  mediaOverlay.replaceChildren();
  for (const info of mediaNodes.values()) {
    const bottomLeft = board.viewport.toScreen({ x: info.x, y: info.y });
    const badge = document.createElement("div");
    badge.className = "media-badge";
    badge.style.left = `${bottomLeft.x}px`;
    badge.style.top = `${bottomLeft.y + 6}px`;
    const icon = document.createElement("span");
    icon.textContent = KIND_ICON[info.type];
    const name = document.createElement("span");
    name.className = "media-name";
    name.textContent = info.name;
    badge.append(icon, name);
    mediaOverlay.appendChild(badge);
  }
}

/**
 * Persists the document after changes settle. Writes are debounced and
 * serialized so a drag does not queue one IndexedDB write per frame.
 */
function wirePersistence(board: PixiBoard): void {
  let timer: number | undefined;
  board.on("change", () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => void persist(board), 400);
  });
  window.addEventListener("pagehide", () => void persist(board));
}

let persistQueue = Promise.resolve();

function persist(board: PixiBoard): Promise<void> {
  persistQueue = persistQueue
    .then(() => mediaLibrary.saveDocument(board.document.toJSON()))
    .catch((error) => {
      console.warn("Failed to persist the document", error);
    });
  return persistQueue;
}

async function clearStorage(board: PixiBoard, resyncMediaBadges: () => void): Promise<void> {
  try {
    await mediaLibrary.clear();
    textureCache.clear();
    await board.document.load(seededDocument());
    board.viewport.fitBounds(padBounds(computeContentBounds(board), 80));
    resyncMediaBadges();
    showToast("已清空浏览器中保存的媒体与文档", "success");
  } catch (error) {
    showToast(`清空失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

function showToast(message: string, tone: "info" | "error" | "success" = "info"): void {
  const toast = document.createElement("div");
  toast.className = tone === "info" ? "toast" : `toast ${tone}`;
  toast.textContent = message;
  toastHost.appendChild(toast);
  window.setTimeout(() => toast.remove(), tone === "error" ? 6000 : 2600);
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

function wirePointerInteractions(board: PixiBoard, transformer: DomTransformer): void {
  let mode: "idle" | "select" | "drag-node" = "idle";
  // Every selected node moves, so the drag carries one origin per node instead
  // of a single handle. Origins are accumulated in world units to keep the drag
  // exact under fractional zoom.
  let dragOrigins: Array<{ id: string; x: number; y: number }> = [];
  let lastScreen = { x: 0, y: 0 };
  let selectStart = { x: 0, y: 0 };
  let lastTapNodeId: string | undefined;
  let lastTapTime = 0;
  // Pressing an already-selected node must keep the group intact so the whole
  // group can be dragged; the collapse to a single node happens on release only
  // if the pointer never actually moved.
  let collapseToOnRelease: string | undefined;
  let movedDuringDrag = false;
  // One key per gesture, shared by every frame of that drag, so the whole
  // move collapses into a single undo step instead of one per frame.
  let dragCoalesceKey: string | undefined;
  let dragSequence = 0;

  const beginNodeDrag = () => {
    dragOrigins = board.selection
      .get()
      .map((id) => board.nodes.get(id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
      .map((item) => ({ id: item.id, x: item.x, y: item.y }));
    mode = dragOrigins.length > 0 ? "drag-node" : "idle";
    dragCoalesceKey = `move:${++dragSequence}`;
  };

  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // The handles stop propagation before this fires, so a resize normally
    // never reaches the canvas at all; this only guards a gesture already in
    // flight (a second pointer, or a synthetic event) from also starting a
    // marquee underneath it.
    if (transformer.dragging()) return;
    board.focus();
    host.setPointerCapture(event.pointerId);
    const screenPoint = toHostPoint(event);
    const worldPoint = board.viewport.toWorld(screenPoint);
    const hitId = hitTestTopmost(board, worldPoint);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    lastScreen = screenPoint;
    collapseToOnRelease = undefined;
    movedDuringDrag = false;

    if (hitId) {
      const now = performance.now();
      if (!additive && hitId === lastTapNodeId && now - lastTapTime < 320) {
        toggleTaskCardStatus(board, hitId);
        lastTapNodeId = undefined;
        return;
      }
      lastTapNodeId = hitId;
      lastTapTime = now;

      if (additive) {
        board.selection.toggle(hitId);
      } else if (!board.selection.get().includes(hitId)) {
        board.selection.set([hitId]);
      } else if (board.selection.get().length > 1) {
        collapseToOnRelease = hitId;
      }
      beginNodeDrag();
    } else {
      lastTapNodeId = undefined;
      if (!additive) board.selection.clear();
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
    } else if (mode === "drag-node" && dragOrigins.length > 0) {
      if (deltaScreen.x !== 0 || deltaScreen.y !== 0) movedDuringDrag = true;
      const scale = board.viewport.get().scale;
      const deltaWorld = { x: deltaScreen.x / scale, y: deltaScreen.y / scale };
      for (const origin of dragOrigins) {
        origin.x += deltaWorld.x;
        origin.y += deltaWorld.y;
      }
      // One transaction per frame keeps the whole group on a single render
      // pass; the shared coalesceKey folds every frame of the gesture into one
      // undo step.
      board.transaction("Move selection", () => {
        for (const origin of dragOrigins) {
          board.nodes.update(origin.id, { x: origin.x, y: origin.y });
        }
      }, { origin: "ui", ...(dragCoalesceKey ? { coalesceKey: dragCoalesceKey } : {}) });
    }
  });

  const endDrag = (event: PointerEvent) => {
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    if (mode === "select") {
      const marqueeIds = nodesInScreenRect(board, selectStart, lastScreen);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const ids = additive ? [...new Set([...board.selection.get(), ...marqueeIds])] : marqueeIds;
      board.selection.set(ids);
      hideSelectionBox();
    } else if (mode === "drag-node" && collapseToOnRelease && !movedDuringDrag) {
      board.selection.set([collapseToOnRelease]);
    }
    mode = "idle";
    dragOrigins = [];
    collapseToOnRelease = undefined;
    movedDuringDrag = false;
    dragCoalesceKey = undefined;
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
  // board.find() deep-clones every node in the document; calling it on every
  // "change" event would mean re-cloning the whole document once per drag
  // frame. The node count only needs to move by the delta a changeSet
  // reports, so it is tracked incrementally instead.
  let nodeCount = board.find().length;
  const refreshCount = () => {
    hudNodes.textContent = String(nodeCount);
  };
  const refreshSelection = () => {
    hudSelection.textContent = String(board.selection.get().length);
  };
  const refreshScale = () => {
    hudScale.textContent = `${Math.round(board.viewport.get().scale * 100)}%`;
  };
  board.on("change", (event) => {
    nodeCount += event.changeSet.addedNodeIds.length - event.changeSet.removedNodeIds.length;
    refreshCount();
  });
  board.on("selection:change", refreshSelection);
  board.on("viewport:change", refreshScale);
  refreshCount();
  refreshSelection();
  refreshScale();

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
