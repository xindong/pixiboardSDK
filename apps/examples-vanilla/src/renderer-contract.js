import { createPixiApplicationFactory, loadPixiRuntime, PixiBoardRenderer } from "@pixi-board/renderer-pixi";

const changeSet = (revision, values = {}) => ({
  transactionId: `browser-renderer-${revision}`,
  revision,
  origin: "api",
  addedNodeIds: [],
  updatedNodeIds: [],
  removedNodeIds: [],
  assetChangedNodeIds: [],
  selectionChanged: false,
  viewportChanged: false,
  timestamp: revision,
  ...values,
});

function node(id, type, x, y, width = 48, height = 48, props = {}, assetRefs) {
  return { id, type, typeVersion: 1, x, y, width, height, rotation: 0, zIndex: 0, props, ...(assetRefs ? { assetRefs } : {}) };
}

function documentOf(revision, nodes, assets = []) {
  return { schemaVersion: 1, revision, nodes, assets };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createTexturePool(pixi, plans = new Map()) {
  const calls = new Map();
  const releasedGenerations = [];
  let active = 0;
  let acquired = 0;
  return {
    get active() { return active; },
    get acquired() { return acquired; },
    get released() { return releasedGenerations.length; },
    releasedGenerations,
    calls,
    async acquireTexture(ref, options = {}) {
      const generation = (calls.get(ref.assetId) ?? 0) + 1;
      calls.set(ref.assetId, generation);
      const plan = plans.get(ref.assetId)?.[generation - 1] ?? { delay: 0, honorAbort: true };
      if (plan.delay) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, plan.delay);
          if (plan.honorAbort !== false) options.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext("2d");
      const hue = Math.abs([...ref.assetId].reduce((value, character) => value * 31 + character.charCodeAt(0), 0)) % 360;
      context.fillStyle = `hsl(${hue} 70% 55%)`;
      context.fillRect(0, 0, 8, 8);
      const texture = pixi.Texture.from(canvas);
      texture.__assetId = ref.assetId;
      texture.__assetGeneration = generation;
      active++;
      acquired++;
      let live = true;
      return {
        texture,
        release() {
          if (!live) return;
          live = false;
          active--;
          releasedGenerations.push(`${ref.assetId}:${generation}`);
          texture.destroy(true);
        },
      };
    },
  };
}

async function createRealRenderer(pixi, host, pool, size = { width: 640, height: 360 }) {
  let application;
  const factory = createPixiApplicationFactory({
    width: size.width,
    height: size.height,
    resolution: 1,
    autoDensity: false,
    autoStart: false,
    sharedTicker: false,
    backgroundAlpha: 0,
  }, async () => pixi);
  const renderer = new PixiBoardRenderer({
    applicationFactory: async () => (application = await factory()),
    acquireTexture: pool.acquireTexture.bind(pool),
  });
  registerCustomRenderer(renderer);
  await renderer.init();
  application.ticker?.stop?.();
  host.appendChild(application.canvas);
  return { renderer, application };
}

function registerCustomRenderer(renderer) {
  renderer.registry.register("contract.card", {
    create(item, context) {
      const root = context.display.createContainer();
      root.mediaKind = "contract.card";
      const label = context.display.createText(item.props.title, { fill: 0xffffff, fontSize: 14 });
      root.addChild(label);
      context.resources.listen(window, "pixiboard-renderer-probe", () => {});
      context.resources.addTicker(() => {});
      return { displayObject: root, state: { label } };
    },
    update(view, item) {
      view.displayObject.x = item.x;
      view.displayObject.y = item.y;
      view.displayObject.width = item.width;
      view.displayObject.height = item.height;
      view.state.label.text = item.props.title;
    },
    destroy(view) { view.displayObject.destroy({ children: true }); },
  });
}

function mediaSmokeDocument(revision = 1) {
  const nodes = [
    node("image", "image", 0, 0, 64, 64, {}, { primary: { assetId: "image-primary" } }),
    node("video", "video", 72, 0, 64, 64, {}, { preview: { assetId: "video-preview", variant: "preview" } }),
    node("audio", "audio", 144, 0, 128, 48, {}, { waveform: { assetId: "audio-waveform", variant: "waveform" } }),
    node("text", "text", 0, 80, 180, 40, { text: "renderer text", style: { fill: "#ffffff", fontSize: 18 } }),
    node("custom", "contract.card", 200, 80, 160, 72, { title: "custom v1" }),
  ];
  return documentOf(revision, nodes, [
    { id: "image-primary", kind: "image" },
    { id: "video-preview", kind: "video-preview" },
    { id: "audio-waveform", kind: "audio-waveform" },
  ]);
}

async function runIncrementalMediaSlice(pixi, root) {
  const host = document.createElement("div"); root.appendChild(host);
  const pool = createTexturePool(pixi);
  const { renderer, application } = await createRealRenderer(pixi, host, pool);
  const context = application.canvas.getContext("webgl2") ?? application.canvas.getContext("webgl");
  await renderer.rebuild(mediaSmokeDocument(1));
  const initialKinds = Object.fromEntries([...renderer.activeViews].map(([id, view]) => [id, view.displayObject.mediaKind ?? id]));
  const initialCreates = renderer.diagnostics.creates;
  const next = mediaSmokeDocument(2);
  next.nodes = next.nodes
    .filter((item) => item.id !== "audio")
    .map((item) => item.id === "text" ? { ...item, props: { ...item.props, text: "renderer text v2" } } : item.id === "custom" ? { ...item, props: { title: "custom v2" } } : item);
  next.nodes.push(node("image-2", "image", 280, 0, 64, 64, {}, { primary: { assetId: "image-second" } }));
  next.assets = next.assets.filter((asset) => asset.id !== "audio-waveform").concat({ id: "image-second", kind: "image" });
  await renderer.apply(next, changeSet(2, { addedNodeIds: ["image-2"], updatedNodeIds: ["text", "custom"], removedNodeIds: ["audio"] }));
  const result = {
    webgl: context !== null,
    rendererName: application.renderer.constructor.name,
    initialKinds,
    initialCreates,
    activeIds: [...renderer.activeViews.keys()].sort(),
    text: renderer.activeViews.get("text").displayObject.text,
    customText: renderer.activeViews.get("custom").state.label.text,
    diagnosticsBeforeDestroy: { ...renderer.diagnostics },
  };
  await renderer.destroy();
  result.diagnosticsAfterDestroy = { ...renderer.diagnostics };
  result.textureBaseline = pool.active;
  host.remove();
  return result;
}

async function runPreviewRace(pixi, root) {
  const host = document.createElement("div"); root.appendChild(host);
  const plans = new Map([["race-preview", [{ delay: 60, honorAbort: false }, { delay: 0, honorAbort: true }]]]);
  const pool = createTexturePool(pixi, plans);
  const { renderer } = await createRealRenderer(pixi, host, pool, { width: 128, height: 128 });
  const raceNode = node("race", "image", 0, 0, 64, 64, {}, { preview: { assetId: "race-preview", variant: "preview" } });
  const first = renderer.rebuild(documentOf(1, [raceNode], [{ id: "race-preview", kind: "image-preview", version: 1 }]));
  while ((pool.calls.get("race-preview") ?? 0) < 1) await delay(0);
  const refreshed = { ...raceNode, x: 1 };
  const second = renderer.apply(documentOf(2, [refreshed], [{ id: "race-preview", kind: "image-preview", version: 2 }]), changeSet(2, { updatedNodeIds: ["race"], assetChangedNodeIds: ["race"] }));
  await Promise.all([first, second]);
  const winningGeneration = renderer.activeViews.get("race").displayObject.texture.__assetGeneration;
  const beforeDestroy = { active: pool.active, releases: [...pool.releasedGenerations], lateUpdates: renderer.diagnostics.lateUpdates };
  await renderer.destroy();
  const afterDestroy = { active: pool.active, releases: [...pool.releasedGenerations], diagnostics: { ...renderer.diagnostics } };
  host.remove();
  return { winningGeneration, beforeDestroy, afterDestroy };
}

async function runDualInstanceIsolation(pixi, root) {
  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");
  root.append(firstHost, secondHost);
  const firstPool = createTexturePool(pixi);
  const secondPool = createTexturePool(pixi);
  const [first, second] = await Promise.all([
    createRealRenderer(pixi, firstHost, firstPool, { width: 128, height: 128 }),
    createRealRenderer(pixi, secondHost, secondPool, { width: 128, height: 128 }),
  ]);
  const sharedNode = node("shared", "image", 0, 0, 64, 64, {}, { primary: { assetId: "shared-asset" } });
  await Promise.all([
    first.renderer.rebuild(documentOf(1, [sharedNode], [{ id: "shared-asset", kind: "image" }])),
    second.renderer.rebuild(documentOf(1, [sharedNode], [{ id: "shared-asset", kind: "image" }])),
  ]);
  const isolatedTextures = first.renderer.activeViews.get("shared").displayObject.texture !== second.renderer.activeViews.get("shared").displayObject.texture;
  await first.renderer.destroy();
  const secondSurvived = second.renderer.activeViews.has("shared") && secondPool.active === 1;
  const firstBaseline = { views: first.renderer.activeViews.size, textures: firstPool.active, diagnostics: { ...first.renderer.diagnostics } };
  await second.renderer.destroy();
  const secondBaseline = { views: second.renderer.activeViews.size, textures: secondPool.active, diagnostics: { ...second.renderer.diagnostics } };
  firstHost.remove(); secondHost.remove();
  return { isolatedTextures, secondSurvived, firstBaseline, secondBaseline };
}

function mediaHeavyDocument(imageCount, videoCount) {
  const nodes = [];
  const assets = [];
  for (let index = 0; index < imageCount; index++) {
    const assetId = `heavy-image-${imageCount}-${index}`;
    const x = (index % 50) * 64;
    const y = Math.floor(index / 50) * 64;
    nodes.push(node(`image-${index}`, "image", x, y, 48, 48, {}, { preview: { assetId, variant: "preview" } }));
    assets.push({ id: assetId, kind: "image-preview" });
  }
  for (let index = 0; index < videoCount; index++) {
    const assetId = `heavy-video-${videoCount}-${index}`;
    nodes.push(node(`video-${index}`, "video", index * 64, 320, 48, 48, {}, { preview: { assetId, variant: "preview" } }));
    assets.push({ id: assetId, kind: "video-preview" });
  }
  return documentOf(1, nodes, assets);
}

async function runMediaHeavyChurn(pixi, root) {
  const scales = [{ images: 100, videos: 1 }, { images: 500, videos: 4 }, { images: 2000, videos: 8 }];
  const results = [];
  for (const scale of scales) {
    const host = document.createElement("div"); root.appendChild(host);
    const pool = createTexturePool(pixi);
    const { renderer } = await createRealRenderer(pixi, host, pool, { width: 512, height: 384 });
    await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: 511, maxY: 383 });
    const snapshot = mediaHeavyDocument(scale.images, scale.videos);
    const loadStart = performance.now();
    await renderer.rebuild(snapshot);
    await nextFrame();
    const firstInteractiveMs = performance.now() - loadStart;
    const samples = [];
    let maxActiveViews = renderer.activeViews.size;
    for (let step = 0; step < 24; step++) {
      const x = (step % 12) * 128;
      const start = performance.now();
      await renderer.setVisibleBounds({ minX: x, minY: 0, maxX: x + 511, maxY: 383 });
      await nextFrame();
      samples.push(performance.now() - start);
      maxActiveViews = Math.max(maxActiveViews, renderer.activeViews.size);
    }
    const visibleLimit = 96;
    const result = {
      ...scale,
      documentNodes: snapshot.nodes.length,
      distinctAssetRefs: new Set(snapshot.nodes.map((item) => Object.values(item.assetRefs)[0].assetId)).size,
      firstInteractiveMs,
      frameMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99), over33Ratio: samples.filter((value) => value > 33).length / samples.length },
      maxActiveViews,
      visibleLimit,
      textureAcquisitions: pool.acquired,
    };
    await renderer.destroy();
    result.destroyBaseline = { views: renderer.activeViews.size, textures: pool.active, diagnostics: { ...renderer.diagnostics } };
    host.remove();
    results.push(result);
  }
  return results;
}

async function runCapture1080p(pixi, root) {
  const host = document.createElement("div"); root.appendChild(host);
  const pool = createTexturePool(pixi);
  const { renderer } = await createRealRenderer(pixi, host, pool, { width: 1920, height: 1080 });
  await renderer.rebuild(documentOf(1, [node("background", "rect", 0, 0, 1920, 1080, { fill: 0x243447 }), node("title", "text", 80, 80, 520, 80, { text: "PixiBoardJS 1080p capture", style: { fill: "#ffffff", fontSize: 40 } })]));
  const before = [...renderer.activeViews.keys()];
  await renderer.capture({ target: "viewport", format: "png" }, { requestId: "capture-warmup" });
  const samples = [];
  let last;
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    last = await renderer.capture({ target: "viewport", format: "png" }, { requestId: `capture-${index}` });
    samples.push(performance.now() - start);
  }
  const result = {
    width: last.width,
    height: last.height,
    mimeType: last.mimeType,
    dataUrlPrefix: last.dataUrl.slice(0, 22),
    latencyMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99) },
    activeSetPreserved: JSON.stringify(before) === JSON.stringify([...renderer.activeViews.keys()]),
  };
  await renderer.destroy();
  result.destroyBaseline = { views: renderer.activeViews.size, textures: pool.active, diagnostics: { ...renderer.diagnostics } };
  host.remove();
  return result;
}

async function runDestroySoak(pixi, root, canvasBaseline) {
  const failures = [];
  let textureAcquisitions = 0;
  for (let cycle = 0; cycle < 100; cycle++) {
    const host = document.createElement("div"); root.appendChild(host);
    const pool = createTexturePool(pixi);
    const { renderer } = await createRealRenderer(pixi, host, pool, { width: 64, height: 64 });
    await renderer.rebuild(documentOf(1, [
      node(`image-${cycle}`, "image", 0, 0, 32, 32, {}, { primary: { assetId: `soak-${cycle}` } }),
      node(`custom-${cycle}`, "contract.card", 32, 0, 32, 32, { title: String(cycle) }),
    ], [{ id: `soak-${cycle}`, kind: "image" }]));
    textureAcquisitions += pool.acquired;
    await renderer.destroy();
    host.remove();
    const diagnostics = renderer.diagnostics;
    if (pool.active !== 0 || renderer.activeViews.size !== 0 || diagnostics.listeners !== 0 || diagnostics.tickers !== 0 || diagnostics.textureLeases !== 0 || document.querySelectorAll("canvas").length !== canvasBaseline) {
      failures.push({ cycle, textures: pool.active, views: renderer.activeViews.size, listeners: diagnostics.listeners, tickers: diagnostics.tickers, leases: diagnostics.textureLeases, canvases: document.querySelectorAll("canvas").length });
    }
  }
  return { cycles: 100, failures, textureAcquisitions, canvasBaseline, finalCanvasCount: document.querySelectorAll("canvas").length };
}

export async function runRendererAcceptanceContract() {
  const pixi = await loadPixiRuntime();
  const root = document.createElement("div");
  root.id = "renderer-contract-root";
  root.style.position = "fixed";
  root.style.left = "-10000px";
  root.style.top = "0";
  document.body.appendChild(root);
  const canvasBaseline = document.querySelectorAll("canvas").length;
  try {
    const incremental = await runIncrementalMediaSlice(pixi, root);
    const previewRace = await runPreviewRace(pixi, root);
    const dualInstance = await runDualInstanceIsolation(pixi, root);
    const mediaHeavy = await runMediaHeavyChurn(pixi, root);
    const capture1080p = await runCapture1080p(pixi, root);
    const destroySoak = await runDestroySoak(pixi, root, canvasBaseline);
    return {
      incremental,
      previewRace,
      dualInstance,
      mediaHeavy,
      capture1080p,
      destroySoak,
      notObserved: ["GPU memory", "draw calls/batches", "idle CPU/GPU"],
    };
  } finally {
    root.remove();
  }
}
