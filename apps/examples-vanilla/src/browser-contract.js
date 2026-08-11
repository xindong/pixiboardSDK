import {
  BrowserPersistenceAdapter,
  NativeDownloadPort,
  NativeIndexedDbPort,
  NativeObjectUrlPort,
  NativeOpfsPort,
  attachOverlayLayer,
  createPixiBoard,
  runBrowserAdapterContract,
} from "pixiboardjs/browser";
import { PixiBoardRenderer } from "@pixi-board/renderer-pixi";
import { runRendererAcceptanceContract } from "./renderer-contract.js";

function boardDocument(revision, marker) {
  return {
    schemaVersion: 1,
    revision,
    assets: [],
    nodes: [{
      id: "browser-node",
      type: "rect",
      typeVersion: 1,
      x: revision,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      zIndex: 0,
      props: { marker },
    }],
  };
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error(`delete blocked: ${name}`)), { once: true });
  });
}

async function seedReloadContract() {
  const databaseName = `pixiboard-browser-reload-${crypto.randomUUID()}`;
  const adapter = new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName }),
  });
  await adapter.saveDocument({ snapshot: boardDocument(1, "before-reload"), expectedRevision: null });
  await adapter.destroy();
  return databaseName;
}

async function readReloadContract(databaseName) {
  const adapter = new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName }),
  });
  const restored = await adapter.loadDocument();
  await adapter.destroy();
  await deleteDatabase(databaseName);
  return restored?.snapshot.nodes[0]?.props.marker;
}

async function deleteOpfsDirectory(name) {
  const storage = navigator.storage;
  if (typeof storage.getDirectory !== "function") return;
  const root = await storage.getDirectory();
  await root.removeEntry(name, { recursive: true }).catch(() => undefined);
}

async function runNativeAdapterContract() {
  const token = crypto.randomUUID();
  const databaseName = `pixiboard-browser-full-${token}`;
  const directoryName = `pixiboard-browser-full-${token}`;
  let generation = 0;
  try {
    return await runBrowserAdapterContract({
      createAdapter: () => new BrowserPersistenceAdapter({
        indexedDb: new NativeIndexedDbPort({ databaseName }),
        opfs: new NativeOpfsPort({ directoryName }),
        objectUrls: new NativeObjectUrlPort(),
        download: new NativeDownloadPort(),
        storageKeyFactory: (id, variant) => `${id}-${variant}-${++generation}-${crypto.randomUUID()}`,
      }),
      inspectObjectUrl: async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        return { type: blob.type, text: await blob.text() };
      },
    });
  } finally {
    await deleteDatabase(databaseName);
    await deleteOpfsDirectory(directoryName);
  }
}

async function runFocusClipboardContract() {
  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");
  document.body.append(firstHost, secondHost);
  const calls = { first: [], second: [], recreated: [] };
  const create = async (host, target) => createPixiBoard({
    headless: true,
    container: host,
    interactions: { keyboard: true, clipboard: true },
    ports: {
      events: window,
      onKeyboardEvent: (event) => target.push(`key:${event.type}`),
      onClipboardEvent: (event) => target.push(`clipboard:${event.type}`),
    },
  });
  const first = await create(firstHost, calls.first);
  const second = await create(secondHost, calls.second);
  await Promise.all([first.ready, second.ready]);

  first.focus();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  for (const type of ["copy", "cut", "paste"]) window.dispatchEvent(new Event(type));
  second.focus();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
  window.dispatchEvent(new Event("paste"));
  await second.destroy();
  window.dispatchEvent(new Event("copy"));

  const recreatedHost = document.createElement("div");
  document.body.append(recreatedHost);
  const recreated = await create(recreatedHost, calls.recreated);
  await recreated.ready;
  recreated.focus();
  window.dispatchEvent(new Event("copy"));
  await Promise.all([first.destroy(), recreated.destroy()]);
  firstHost.remove();
  secondHost.remove();
  recreatedHost.remove();
  return calls;
}

async function runPersistenceContract() {
  const databaseName = `pixiboard-browser-contract-${crypto.randomUUID()}`;
  const first = new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName }),
  });
  const second = new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName }),
  });
  await first.saveDocument({ snapshot: boardDocument(1, "initial"), expectedRevision: null });
  const [firstLoaded, secondLoaded] = await Promise.all([
    first.loadDocument(),
    second.loadDocument(),
  ]);
  const candidates = [boardDocument(2, "first-writer"), boardDocument(2, "second-writer")];
  const writes = await Promise.allSettled([
    first.saveDocument({ snapshot: candidates[0], expectedRevision: firstLoaded?.snapshot.revision ?? null }),
    second.saveDocument({ snapshot: candidates[1], expectedRevision: secondLoaded?.snapshot.revision ?? null }),
  ]);
  const winnerIndex = writes.findIndex(({ status }) => status === "fulfilled");
  const conflictResult = writes.find(({ status }) => status === "rejected");
  const conflict = conflictResult?.reason ?? {};
  const winnerMarker = candidates[winnerIndex]?.nodes[0]?.props.marker;
  await Promise.all([first.destroy(), second.destroy()]);

  const native = new NativeIndexedDbPort({ databaseName });
  let failWithQuota = true;
  const quotaPort = new Proxy(native, {
    get(target, property, receiver) {
      if (property === "saveDocument") {
        return async (...args) => {
          if (failWithQuota) {
            failWithQuota = false;
            throw new DOMException("browser contract quota", "QuotaExceededError");
          }
          return target.saveDocument(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const reopened = new BrowserPersistenceAdapter({ indexedDb: quotaPort });
  const restored = await reopened.loadDocument();
  let quota = {};
  try {
    await reopened.saveDocument({ snapshot: boardDocument(3, "quota-failure"), expectedRevision: 2 });
  } catch (error) {
    quota = error;
  }
  const afterQuotaFailure = await reopened.loadDocument();
  await reopened.saveDocument({ snapshot: boardDocument(3, "quota-retry"), expectedRevision: 2 });
  await reopened.destroy();

  const verification = new BrowserPersistenceAdapter({
    indexedDb: new NativeIndexedDbPort({ databaseName }),
  });
  const final = await verification.loadDocument();
  await verification.destroy();
  await deleteDatabase(databaseName);
  return {
    conflict: {
      successfulWrites: writes.filter(({ status }) => status === "fulfilled").length,
      rejectedWrites: writes.filter(({ status }) => status === "rejected").length,
      name: conflict.name,
      expectedRevision: conflict.expectedRevision,
      actualRevision: conflict.actualRevision,
    },
    quota: {
      name: quota.name,
      retryable: quota.retryable,
      causeName: quota.cause?.name,
    },
    winnerMarker,
    restoredMarker: restored?.snapshot.nodes[0]?.props.marker,
    afterQuotaMarker: afterQuotaFailure?.snapshot.nodes[0]?.props.marker,
    finalMarker: final?.snapshot.nodes[0]?.props.marker,
  };
}

function displayObject() {
  return {
    children: [],
    addChild(child) { this.children.push(child); },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); },
    destroy() { this.children = []; },
  };
}

const viewFactory = {
  createContainer: displayObject,
  createRect: displayObject,
  createImage: displayObject,
  createText: displayObject,
};

function webGlApplication(onContext, { failInit = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  document.body.append(canvas);
  return {
    canvas,
    stage: displayObject(),
    init() {
      if (failInit) throw new Error("injected renderer failure");
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (context === null) throw new Error("Chromium WebGL context is unavailable");
      onContext(context);
    },
    destroy() { canvas.remove(); },
  };
}

async function createHealthyRenderer(onContext) {
  const renderer = new PixiBoardRenderer({
    viewFactory,
    applicationFactory: () => webGlApplication(onContext),
  });
  await renderer.init();
  return renderer;
}

async function runWebGlRecoveryContract() {
  const snapshot = boardDocument(1, "webgl-recovery");
  let firstContext;
  const first = await createHealthyRenderer((context) => { firstContext = context; });
  await first.rebuild(snapshot);
  const canvas = firstContext.canvas;
  const extension = firstContext.getExtension("WEBGL_lose_context");
  if (extension === null) {
    await first.destroy();
    return {
      contextResult: { supported: false, reason: "WEBGL_lose_context is unavailable" },
      failureResult: undefined,
    };
  }
  const lost = new Promise((resolve) => {
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      resolve(event.defaultPrevented);
    }, { once: true });
  });
  extension.loseContext();
  const defaultPrevented = await lost;
  await first.destroy();

  let replacementContexts = 0;
  const replacement = await createHealthyRenderer(() => { replacementContexts++; });
  await replacement.rebuild(snapshot);
  const contextResult = {
    supported: true,
    defaultPrevented,
    replacementContexts,
    activeAfterRecovery: replacement.activeViews.has("browser-node"),
  };
  await replacement.destroy();

  const failed = new PixiBoardRenderer({
    viewFactory,
    applicationFactory: () => webGlApplication(() => undefined, { failInit: true }),
  });
  let initialError = "";
  try {
    await failed.init();
  } catch (error) {
    initialError = error.message;
  }
  await failed.destroy();
  const recovered = await createHealthyRenderer(() => undefined);
  await recovered.rebuild(boardDocument(1, "renderer-recovered"));
  const failureResult = {
    initialError,
    activeAfterRecovery: recovered.activeViews.has("browser-node"),
  };
  await recovered.destroy();
  return { contextResult, failureResult };
}

/**
 * Exercises the DOM overlay layer in a real browser: pooling across pans,
 * transform-based positioning, declutter, candidate culling and teardown.
 * These are the parts that only a live DOM can prove.
 */
async function runOverlayLayerContract() {
  const host = document.createElement("div");
  host.style.position = "relative";
  host.style.width = "400px";
  host.style.height = "300px";
  document.body.append(host);
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.pointerEvents = "none";
  host.append(container);

  const board = await createPixiBoard({ headless: true, container: host });
  await board.ready;
  // Node data types are host-registered; the overlay layer resolves bounds
  // through the same registry the renderer culls with.
  await board.nodeTypes.register({
    type: "overlay.card",
    version: 1,
    defaults: { label: "" },
    validate: (value) => ({ label: String(value?.label ?? "") }),
    getBounds: (node) => ({
      minX: node.x,
      minY: node.y,
      maxX: node.x + node.width,
      maxY: node.y + node.height,
    }),
  });
  const nodeIds = [];
  for (let index = 0; index < 5; index++) {
    const handle = await board.nodes.create({
      type: "overlay.card",
      x: index * 100,
      y: 0,
      width: 40,
      height: 20,
      props: { label: `node-${index}` },
    });
    nodeIds.push(handle.id);
  }

  let renders = 0;
  let candidates;
  // Synchronous scheduling keeps the contract deterministic; the rAF batching
  // itself is covered by the "one flush per frame" assertion below.
  const layer = attachOverlayLayer(board, {
    container,
    candidates: () => candidates,
    item: (node) => ({
      anchor: "bottom-left",
      offset: { x: 0, y: 6 },
      scale: { mode: "clamped", min: 0.5, max: 2 },
      declutter: { minScale: 0.2, collapseBelowScale: 0.6 },
      data: node.props.label,
    }),
    render: ({ element, placement }) => {
      renders++;
      element.textContent = String(placement.data);
    },
    schedule: (callback) => { callback(); return () => undefined; },
  });
  layer.flush();

  const elementsFor = () => [...container.children];
  const initial = elementsFor();
  const initialTransforms = initial.map((element) => element.style.transform);

  // Positioning must go through transform, never left/top: writing those per
  // frame forces layout for every item.
  const usesTransformOnly = initial.every((element) => (
    element.style.transform.startsWith("translate3d(") &&
    (element.style.left === "0px" || element.style.left === "0") &&
    (element.style.top === "0px" || element.style.top === "0")
  ));

  // A pan must move existing elements, not rebuild the subtree.
  board.viewport.panBy(25, 10);
  layer.flush();
  const afterPan = elementsFor();
  const pooledAcrossPan = afterPan.length === initial.length &&
    afterPan.every((element, index) => element === initial[index]);
  const movedAcrossPan = afterPan.every((element, index) => element.style.transform !== initialTransforms[index]);

  // Zooming out past collapseBelowScale marks items collapsed; past minScale
  // they leave the DOM entirely.
  board.viewport.set({ scale: 0.5, offset: { x: 0, y: 0 } });
  layer.flush();
  const collapsedCount = elementsFor().filter((element) => (
    element.className.includes("pixiboard-overlay-item-collapsed")
  )).length;
  const scaledWhenClamped = elementsFor().every((element) => element.style.transform.includes("scale(0.5)"));

  board.viewport.set({ scale: 0.1, offset: { x: 0, y: 0 } });
  layer.flush();
  const hiddenBelowMinScale = elementsFor().length;

  board.viewport.set({ scale: 1, offset: { x: 0, y: 0 } });
  layer.flush();
  const restoredAfterZoomBack = elementsFor().length;
  // Elements come back from the pool rather than being freshly allocated.
  const reusedFromPool = elementsFor().every((element) => initial.includes(element));

  // Candidate culling: only the listed ids get elements. An undefined result
  // must mean "no culling information", not "nothing visible".
  candidates = nodeIds.slice(0, 2);
  layer.refresh();
  layer.flush();
  const culledCount = elementsFor().length;
  candidates = undefined;
  layer.refresh();
  layer.flush();
  const unculledCount = elementsFor().length;

  // Default culling: with no `candidates` option the layer follows the board's
  // own visible set, which on a headless board is "unknown" — and unknown has
  // to render everything rather than nothing.
  const defaultCulled = attachOverlayLayer(board, {
    container,
    item: () => ({}),
    render: () => undefined,
    schedule: (callback) => { callback(); return () => undefined; },
  });
  defaultCulled.flush();
  const defaultCandidateCount = defaultCulled.size();
  const boardReportsNoCulling = board.visibleNodeIds() === undefined;
  defaultCulled.destroy();

  // Batching: several invalidations in one frame collapse into one flush.
  let framed = 0;
  let pending;
  const batched = attachOverlayLayer(board, {
    container,
    item: () => ({}),
    render: () => { framed++; },
    schedule: (callback) => { pending = callback; return () => { pending = undefined; }; },
  });
  framed = 0;
  batched.refresh();
  batched.refresh();
  batched.refresh();
  pending?.();
  const rendersPerFrame = framed;
  batched.destroy();

  const beforeDestroy = elementsFor().length;
  layer.destroy();
  const afterDestroy = elementsFor().length;
  // A destroyed layer must also stop reacting to the board.
  board.viewport.panBy(10, 10);
  const afterDestroyPan = elementsFor().length;

  await board.destroy();
  host.remove();

  return {
    usesTransformOnly,
    pooledAcrossPan,
    movedAcrossPan,
    collapsedCount,
    scaledWhenClamped,
    hiddenBelowMinScale,
    restoredAfterZoomBack,
    reusedFromPool,
    culledCount,
    unculledCount,
    defaultCandidateCount,
    boardReportsNoCulling,
    rendersPerFrame,
    renderedAtLeastOnce: renders > 0,
    beforeDestroy,
    afterDestroy,
    afterDestroyPan,
  };
}

export const browserContracts = {
  seedReloadContract,
  readReloadContract,
  runNativeAdapterContract,
  runFocusClipboardContract,
  runPersistenceContract,
  runWebGlRecoveryContract,
  runRendererAcceptanceContract,
  runOverlayLayerContract,
};
