import { chromium } from "@playwright/test";

const PIXI_URL = "https://cdn.jsdelivr.net/npm/pixi.js@8.15.0/dist/pixi.min.js";
const KONVA_URL = "https://cdn.jsdelivr.net/npm/konva@10.3.0/konva.min.js";
const DEFAULT_COUNTS = [10_000, 50_000, 100_000];
const DEFAULT_VIEWPORT = { width: 1_920, height: 1_080, dpr: 1 };

function readArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const next = argv[index + 1];
    args.set(key, next && !next.startsWith("--") ? next : true);
    if (next && !next.startsWith("--")) index += 1;
  }
  return args;
}

function percentile(values, rank) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * rank) - 1)] ?? null;
}

function parseCounts(args) {
  const raw = args.get("--counts") ?? args.get("--count");
  if (raw === undefined || raw === true) return DEFAULT_COUNTS;
  const counts = String(raw).split(",").map((value) => Number(value.trim()));
  if (counts.some((count) => !Number.isInteger(count) || count < 1)) throw new RangeError("--counts must contain positive integers");
  return counts;
}

function parseModes(args) {
  const raw = args.get("--modes");
  if (raw === undefined || raw === true) return ["matched-visible"];
  const modes = String(raw).split(",").map((value) => value.trim());
  if (modes.some((mode) => mode !== "matched-visible" && mode !== "full-retained")) {
    throw new RangeError("--modes accepts matched-visible and full-retained");
  }
  return [...new Set(modes)];
}

async function runBrowserBenchmark({ counts, modes, viewport = DEFAULT_VIEWPORT }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
    await page.setContent('<!doctype html><html><body style="margin:0;background:#111"><div id="host"></div></body></html>');
    await page.addScriptTag({ url: PIXI_URL });
    await page.addScriptTag({ url: KONVA_URL });
    await page.waitForFunction(() => Boolean(window.PIXI && window.Konva));
    const observations = await page.evaluate(async ({ counts: requestedCounts, modes: requestedModes, viewport: requestedViewport }) => {
      const percentile = (values, rank) => {
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[Math.max(0, Math.ceil(sorted.length * rank) - 1)] ?? null;
      };
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const sample = async (name, count, mode, create, update, destroy) => {
        const coldStarted = performance.now();
        const scene = await create(count, mode);
        await nextFrame();
        const coldMs = performance.now() - coldStarted;
        const frames = [];
        for (let step = 0; step < 20; step += 1) {
          const started = performance.now();
          await update(scene, step);
          await nextFrame();
          frames.push(performance.now() - started);
        }
        const result = {
          renderer: name,
          datasetCount: count,
          retentionMode: mode,
          viewport: `${requestedViewport.width}x${requestedViewport.height}@${requestedViewport.dpr}`,
          coldMs,
          steadyFrameP50Ms: percentile(frames, 0.5),
          steadyFrameP95Ms: percentile(frames, 0.95),
          steadyFrameP99Ms: percentile(frames, 0.99),
          longFrameRatio: frames.filter((value) => value > 33).length / frames.length,
          activeObjectCount: scene.activeObjectCount,
          webgl: Boolean(scene.webgl),
        };
        await destroy(scene);
        return result;
      };
      const visibleCountFor = (count) => count === 10_000 ? 200 : 300;
      const makeNodes = (count) => {
        const nodes = new Array(count);
        for (let index = 0; index < count; index += 1) {
          nodes[index] = { x: (index * 7919) % 1_000_000, y: (index * 104_729) % 1_000_000, width: 320, height: 180 };
        }
        return nodes;
      };
      const createPixi = async (count, mode) => {
        const app = new window.PIXI.Application();
        await app.init({ width: requestedViewport.width, height: requestedViewport.height, resolution: requestedViewport.dpr, autoDensity: false, autoStart: false, preference: "webgl", backgroundAlpha: 0 });
        const world = new window.PIXI.Container();
        app.stage.addChild(world);
        const nodes = makeNodes(count);
        const limit = mode === "matched-visible" ? visibleCountFor(count) : count;
        for (let index = 0; index < limit; index += 1) {
          const node = nodes[index];
          const rect = new window.PIXI.Graphics().rect(0, 0, node.width, node.height).fill(0x4c8dff);
          rect.position.set(node.x, node.y);
          world.addChild(rect);
        }
        app.render();
        document.querySelector("#host").appendChild(app.canvas);
        return { app, world, activeObjectCount: limit, webgl: app.renderer?.type === "webgl" || Boolean(app.renderer?.gl) };
      };
      const createKonva = async (count, mode) => {
        const host = document.querySelector("#host");
        const element = document.createElement("div");
        host.appendChild(element);
        const stage = new window.Konva.Stage({ container: element, width: requestedViewport.width, height: requestedViewport.height });
        const layer = new window.Konva.Layer();
        stage.add(layer);
        const nodes = makeNodes(count);
        const limit = mode === "matched-visible" ? visibleCountFor(count) : count;
        for (let index = 0; index < limit; index += 1) {
          const node = nodes[index];
          layer.add(new window.Konva.Rect({ x: node.x, y: node.y, width: node.width, height: node.height, fill: "#4c8dff" }));
        }
        layer.draw();
        return { stage, layer, element, activeObjectCount: limit, webgl: false };
      };
      const updatePixi = async (scene, step) => { scene.world.position.x = -((step * 97) % 4_000); scene.world.position.y = -((step * 61) % 2_000); scene.app.render(); };
      const updateKonva = async (scene, step) => { scene.layer.position({ x: -((step * 97) % 4_000), y: -((step * 61) % 2_000) }); scene.layer.draw(); };
      const destroyPixi = async (scene) => { scene.app.destroy(true); };
      const destroyKonva = async (scene) => { scene.stage.destroy(); scene.element.remove(); };
      const output = [];
      for (const count of requestedCounts) {
        for (const mode of requestedModes) {
          output.push(await sample("pixi", count, mode, createPixi, updatePixi, destroyPixi));
          output.push(await sample("konva", count, mode, createKonva, updateKonva, destroyKonva));
        }
      }
      return output;
    }, { counts, modes, viewport });
    return {
      schemaVersion: 1,
      environment: { browser: await page.evaluate(() => navigator.userAgent), viewport, renderer: "PixiJS WebGL + Konva Canvas2D" },
      observations,
      notObserved: ["GPU memory", "draw calls/batches", "idle CPU/GPU", "hardware-GPU throughput when using SwiftShader"],
    };
  } finally {
    await browser.close();
  }
}

const args = readArgs(process.argv);
try {
  const report = await runBrowserBenchmark({ counts: parseCounts(args), modes: parseModes(args) });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Browser benchmark unavailable: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
