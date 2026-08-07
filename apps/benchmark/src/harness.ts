import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { BoardCore, type BoardDocument, type BoardNode, type BoardChangeEvent, type WorldBounds } from "@pixi-board/core";
import { GridSpatialIndex, PixiBoardRenderer, type PixiApplication, type PixiDisplayObject, type PixiViewFactory } from "@pixi-board/renderer-pixi";
import { createPixiBoard } from "pixiboardjs";
import { summarizeMetricSamples } from "./metrics.mjs";
import { runScenario } from "./runner.mjs";
import { generateSyntheticCards } from "./synthetic-card.mjs";

const DEFAULT_COUNTS = [1_000, 10_000, 50_000, 100_000] as const;
const WORLD_SIZE = 1_000_000;

type SyntheticDataset = ReturnType<typeof generateSyntheticCards>;
type Observation = Awaited<ReturnType<typeof runScenario>> & {
  datasetCount?: number;
  invariants?: Record<string, boolean | number | string>;
};

export type HarnessOptions = {
  counts?: number[];
  seed?: number;
  queryIterations?: number;
  singleUpdateIterations?: number | ((count: number) => number);
  batchIterations?: number | ((count: number) => number);
  soakCycles?: number;
  includeFacadeBatch?: boolean;
};

function duration(operation: () => void): number {
  const started = performance.now();
  operation();
  return performance.now() - started;
}

async function asyncDuration(operation: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

function iterations(value: HarnessOptions["singleUpdateIterations"], count: number, fallback: (count: number) => number): number {
  return typeof value === "function" ? value(count) : value ?? fallback(count);
}

function toDocument(dataset: SyntheticDataset): BoardDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    nodes: dataset.nodes.map((node) => ({
      id: node.id,
      type: "rect",
      typeVersion: 1,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: 0,
      zIndex: node.zIndex,
      assetRefs: { image: { assetId: node.assetId } },
      props: node.data,
    })),
    assets: dataset.sharedAssets.map((asset) => ({ ...asset })),
    metadata: { fixture: dataset.name, seed: dataset.seed },
  };
}

function spatialItems(document: BoardDocument) {
  return document.nodes.map((node) => ({
    id: node.id,
    minX: node.x,
    minY: node.y,
    maxX: node.x + node.width,
    maxY: node.y + node.height,
  }));
}

function queryBounds(count: number, iteration: number): WorldBounds {
  const desiredVisible = count === 1_000 ? 50 : count === 10_000 ? 200 : 300;
  const span = Math.max(1_920, Math.sqrt(desiredVisible / count) * WORLD_SIZE);
  const available = Math.max(1, WORLD_SIZE - span);
  const minX = (iteration * 104_729) % available;
  const minY = (iteration * 130_363) % available;
  return { minX, minY, maxX: minX + span, maxY: minY + span };
}

function chooseRendererBounds(index: GridSpatialIndex, count: number): { bounds: WorldBounds; visibleIds: string[] } {
  const desiredVisible = count === 1_000 ? 50 : count === 10_000 ? 200 : 300;
  let best = { bounds: queryBounds(count, 0), visibleIds: [] as string[] };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const bounds = queryBounds(count, iteration);
    const visibleIds = [...index.query(bounds)];
    const distance = Math.abs(visibleIds.length - desiredVisible);
    if (distance < bestDistance) {
      best = { bounds, visibleIds };
      bestDistance = distance;
    }
  }
  return best;
}

function createDisplayObject(): PixiDisplayObject {
  return {
    children: [],
    addChild(child: PixiDisplayObject) {
      (this.children as PixiDisplayObject[]).push(child);
    },
    removeChild(child: PixiDisplayObject) {
      this.children = (this.children as PixiDisplayObject[]).filter((item) => item !== child);
    },
    destroy() {
      this.destroyed = true;
      this.children = [];
    },
  };
}

function rendererPorts() {
  const stage = createDisplayObject();
  const app: PixiApplication = {
    stage,
    async init() {},
    destroy() { stage.destroy?.({ children: true }); },
  };
  const viewFactory: PixiViewFactory = {
    createContainer: createDisplayObject,
    createRect: createDisplayObject,
    createImage: createDisplayObject,
    createText(text) { return { ...createDisplayObject(), text }; },
  };
  return { app, viewFactory };
}

function observed(result: Awaited<ReturnType<typeof runScenario>>, count?: number, invariants?: Observation["invariants"]): Observation {
  return { ...result, ...(count === undefined ? {} : { datasetCount: count }), ...(invariants ? { invariants } : {}) };
}

function coreIdFactory() {
  let value = 0;
  return () => `benchmark-transaction-${++value}`;
}

async function runDatasetBenchmarks(dataset: SyntheticDataset, document: BoardDocument, options: HarnessOptions): Promise<Observation[]> {
  const count = dataset.count;
  const observations: Observation[] = [];

  const load = await runScenario({
    adapter: {
      name: "pixiboard-core",
      "document-load": () => {
        let core!: BoardCore;
        const documentLoadMs = duration(() => {
          core = new BoardCore({ document, idFactory: coreIdFactory(), now: () => 1 });
        });
        return { durationMs: documentLoadMs, documentLoadMs, nodeCount: core.nodes.list().length };
      },
    },
    dataset,
    scenario: "document-load",
    iterations: count >= 100_000 ? 1 : count >= 50_000 ? 2 : 3,
    warmup: 1,
  });
  observations.push(observed(load, count, { loadedNodeCount: document.nodes.length }));

  // The synthetic world is 1,000,000px wide. A 4,096px cell keeps sparse
  // viewport queries proportional to intersecting buckets instead of walking
  // hundreds of thousands of empty 256px cells.
  const index = new GridSpatialIndex(4_096);
  const items = spatialItems(document);
  const rebuild = await runScenario({
    adapter: {
      name: "grid-spatial-index",
      "spatial-rebuild": () => ({ durationMs: duration(() => index.rebuild(items)), indexedNodeCount: items.length }),
    },
    dataset,
    scenario: "spatial-rebuild",
    iterations: count >= 100_000 ? 3 : 5,
    warmup: 1,
  });
  observations.push(observed(rebuild, count, { indexedNodeCount: items.length, cellSize: 4_096 }));

  index.rebuild(items);
  const queryCount = options.queryIterations ?? 40;
  const spatialQuery = await runScenario({
    adapter: {
      name: "grid-spatial-index",
      "spatial-query": ({ iteration }: { iteration: number }) => {
        const bounds = queryBounds(count, iteration);
        let visibleIds: string[] = [];
        const queryMs = duration(() => { visibleIds = [...index.query(bounds)]; });
        return { durationMs: queryMs, visibleCount: visibleIds.length };
      },
    },
    dataset,
    scenario: "spatial-query",
    iterations: queryCount,
    warmup: 3,
  });
  observations.push(observed(spatialQuery, count, { queryCount, cellSize: 4_096 }));

  const selected = chooseRendererBounds(index, count);
  let rendererForApply: PixiBoardRenderer | undefined;
  let coreForApply: BoardCore | undefined;
  let changeForApply: BoardChangeEvent | undefined;
  const rendererCulling = await runScenario({
    adapter: {
      name: "pixiboard-renderer-instrumented",
      "renderer-culling": async () => {
        const { app, viewFactory } = rendererPorts();
        const renderer = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory, cullingQuery: () => selected.visibleIds });
        const firstInteractiveMs = await asyncDuration(async () => {
          await renderer.init();
          await renderer.setVisibleBounds(selected.bounds);
          await renderer.rebuild(document);
        });
        const activeViewCount = renderer.activeViews.size;
        const diagnostics = { ...renderer.diagnostics };
        await renderer.destroy();
        return {
          durationMs: firstInteractiveMs,
          firstInteractiveMs,
          visibleCount: selected.visibleIds.length,
          activeViewCount,
          createdViewCount: diagnostics.creates,
          destroyedViewCount: renderer.diagnostics.destroys,
          rendererBackend: "instrumented-pixi-adapter",
        };
      },
    },
    dataset,
    scenario: "renderer-culling",
    iterations: 1,
  });
  const rendererSample = rendererCulling.samples[0] ?? {};
  observations.push(observed(rendererCulling, count, {
    activeViewsEqualVisibleSet: rendererSample.activeViewCount === rendererSample.visibleCount,
    activeViewsBelow1_5xVisible: Number(rendererSample.activeViewCount) <= Number(rendererSample.visibleCount) * 1.5,
    doesNotCreateAllDocumentViews: Number(rendererSample.activeViewCount) < count,
    viewsReturnToZeroAfterDestroy: rendererSample.createdViewCount === rendererSample.destroyedViewCount,
  }));

  {
    const { app, viewFactory } = rendererPorts();
    rendererForApply = new PixiBoardRenderer({ applicationFactory: () => app, viewFactory, cullingQuery: () => selected.visibleIds });
    await rendererForApply.init();
    await rendererForApply.setVisibleBounds(selected.bounds);
    await rendererForApply.rebuild(document);
    coreForApply = new BoardCore({ document, idFactory: coreIdFactory(), now: () => 1 });
    coreForApply.on("change", (event) => { changeForApply = event; });
  }
  const applyNodeId = selected.visibleIds[0] ?? document.nodes[0].id;
  const rendererApply = await runScenario({
    adapter: {
      name: "pixiboard-renderer-instrumented",
      "renderer-single-node-apply": async ({ iteration }: { iteration: number }) => {
        const before = coreForApply!.nodes.get(applyNodeId)!;
        coreForApply!.nodes.update(applyNodeId, { x: before.x + (iteration % 2 === 0 ? 1 : -1) });
        const applyMs = await asyncDuration(() => rendererForApply!.apply(coreForApply!.document.snapshot(), changeForApply!.changeSet));
        return { durationMs: applyMs, activeViewCount: rendererForApply!.activeViews.size, updatedNodeCount: changeForApply!.changeSet.updatedNodeIds.length };
      },
    },
    dataset,
    scenario: "renderer-single-node-apply",
    iterations: count >= 100_000 ? 2 : 3,
    warmup: 1,
  });
  observations.push(observed(rendererApply, count, {
    changeSetContainsOneNode: rendererApply.samples.every((sample: Record<string, unknown>) => sample.updatedNodeCount === 1),
    activeViewsRemainBounded: rendererApply.samples.every((sample: Record<string, unknown>) => Number(sample.activeViewCount) <= selected.visibleIds.length * 1.5),
  }));
  await rendererForApply.destroy();

  const core = new BoardCore({ document, idFactory: coreIdFactory(), now: () => 1 });
  let singleChange: BoardChangeEvent | undefined;
  core.on("change", (event) => { singleChange = event; });
  const singleNodeId = document.nodes[Math.floor(document.nodes.length / 2)].id;
  const singleUpdate = await runScenario({
    adapter: {
      name: "pixiboard-core",
      "core-single-node-update": ({ iteration }: { iteration: number }) => {
        const beforeRevision = core.document.snapshot().revision;
        const before = core.nodes.get(singleNodeId)!;
        singleChange = undefined;
        const coreTransactionLatencyMs = duration(() => {
          core.nodes.update(singleNodeId, { x: before.x + (iteration % 2 === 0 ? 1 : -1) });
        });
        return {
          durationMs: coreTransactionLatencyMs,
          coreTransactionLatencyMs,
          revisionDelta: core.document.snapshot().revision - beforeRevision,
          changeSetCount: singleChange ? 1 : 0,
          updatedNodeCount: singleChange?.changeSet.updatedNodeIds.length ?? 0,
        };
      },
    },
    dataset,
    scenario: "core-single-node-update",
    iterations: iterations(options.singleUpdateIterations, count, (value) => value >= 100_000 ? 1 : value >= 50_000 ? 2 : 10),
    warmup: 1,
  });
  observations.push(observed(singleUpdate, count, {
    oneRevisionPerUpdate: singleUpdate.samples.every((sample: Record<string, unknown>) => sample.revisionDelta === 1),
    oneChangeSetPerUpdate: singleUpdate.samples.every((sample: Record<string, unknown>) => sample.changeSetCount === 1),
    oneUpdatedNodePerUpdate: singleUpdate.samples.every((sample: Record<string, unknown>) => sample.updatedNodeCount === 1),
  }));

  const batchCore = new BoardCore({ document, idFactory: coreIdFactory(), now: () => 1 });
  let batchChange: BoardChangeEvent | undefined;
  let batchChangeCount = 0;
  batchCore.on("change", (event) => { batchChange = event; batchChangeCount += 1; });
  const batchIds = document.nodes.slice(0, 1_000).map((node) => node.id);
  const batchUpdate = await runScenario({
    adapter: {
      name: "pixiboard-core",
      "core-batch-update-1000": ({ iteration }: { iteration: number }) => {
        const beforeRevision = batchCore.document.snapshot().revision;
        const beforeChanges = batchChangeCount;
        batchChange = undefined;
        const coreTransactionLatencyMs = duration(() => {
          batchCore.transaction("Benchmark update 1000", () => {
            for (const id of batchIds) {
              const node = batchCore.nodes.get(id)!;
              batchCore.nodes.update(id, { y: node.y + (iteration % 2 === 0 ? 1 : -1) });
            }
          });
        });
        return {
          durationMs: coreTransactionLatencyMs,
          coreTransactionLatencyMs,
          revisionDelta: batchCore.document.snapshot().revision - beforeRevision,
          changeSetCount: batchChangeCount - beforeChanges,
          updatedNodeCount: batchChange?.changeSet.updatedNodeIds.length ?? 0,
        };
      },
    },
    dataset,
    scenario: "core-batch-update-1000",
    iterations: iterations(options.batchIterations, count, (value) => value >= 100_000 ? 1 : value >= 50_000 ? 1 : 3),
    warmup: 1,
  });
  observations.push(observed(batchUpdate, count, {
    batchSize: batchIds.length,
    oneRevisionPerBatch: batchUpdate.samples.every((sample: Record<string, unknown>) => sample.revisionDelta === 1),
    oneChangeSetPerBatch: batchUpdate.samples.every((sample: Record<string, unknown>) => sample.changeSetCount === 1),
    changeSetContains1000Nodes: batchUpdate.samples.every((sample: Record<string, unknown>) => sample.updatedNodeCount === 1_000),
  }));

  return observations;
}

class TrackedEventTarget {
  private readonly listeners = new Map<string, Set<unknown>>();
  addEventListener(type: string, listener: unknown) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type: string, listener: unknown) { this.listeners.get(type)?.delete(listener); }
  focus() {}
  get count() { return [...this.listeners.values()].reduce((total, values) => total + values.size, 0); }
}

class TrackedTicker {
  readonly listeners = new Set<() => void>();
  add(listener: () => void) { this.listeners.add(listener); }
  remove(listener: () => void) { this.listeners.delete(listener); }
}

async function runFacadeBatch(document: BoardDocument): Promise<Observation> {
  let saveCount = 0;
  const board = await createPixiBoard({
    headless: true,
    document,
    core: { idFactory: coreIdFactory(), now: () => 1 },
    persistence: { async save() { saveCount += 1; } },
  });
  await board.ready;
  let changeCount = 0;
  let resolveChange!: () => void;
  const changed = new Promise<void>((resolve) => { resolveChange = resolve; });
  board.on("change", () => { changeCount += 1; resolveChange(); });
  const beforeRevision = board.document.snapshot().revision;
  const ids = board.nodes.list({ limit: 1_000 }).map((node) => node.id);
  const elapsed = await asyncDuration(async () => {
    board.transaction("Facade benchmark update 1000", () => {
      for (const id of ids) {
        const node = board.nodes.get(id)!;
        board.nodes.update(id, { x: node.x + 1 });
      }
    });
    await changed;
  });
  const revisionDelta = board.document.snapshot().revision - beforeRevision;
  await board.destroy();
  const sample = {
    scenario: "facade-batch-update-1000",
    dataset: "synthetic-card",
    iteration: 0,
    durationMs: elapsed,
    revisionDelta,
    changeSetCount: changeCount,
    persistenceSaveCount: saveCount,
    updatedNodeCount: ids.length,
    longFrame: false,
  };
  return {
    status: "observed",
    observed: true,
    adapter: "pixiboardjs-facade",
    scenario: "facade-batch-update-1000",
    dataset: "synthetic-card",
    datasetCount: document.nodes.length,
    samples: [sample],
    summary: summarizeMetricSamples([sample]),
    invariants: {
      batchSize: ids.length,
      oneRevision: revisionDelta === 1,
      oneChangeSet: changeCount === 1,
      onePersistenceSave: saveCount === 1,
    },
  } as Observation;
}

async function runLifecycleSoak(cycles: number): Promise<Observation> {
  const events = new TrackedEventTarget();
  const container = new TrackedEventTarget();
  const ticker = new TrackedTicker();
  let activeObservers = 0;
  let textureLeases = 0;
  let peakListeners = 0;
  let peakTickers = 0;
  let peakViews = 0;
  let peakTextures = 0;
  const residuals: Array<Record<string, number>> = [];
  const samples = [];
  const nodes: BoardNode[] = Array.from({ length: 8 }, (_, index) => ({
    id: `soak-image-${index}`,
    type: "image",
    typeVersion: 1,
    x: index * 100,
    y: 0,
    width: 80,
    height: 80,
    rotation: 0,
    zIndex: index,
    assetRefs: { image: { assetId: `asset-${index % 2}` } },
    props: {},
  }));
  const document: BoardDocument = { schemaVersion: 1, revision: 0, nodes, assets: [] };

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    let renderer!: PixiBoardRenderer;
    const { app, viewFactory } = rendererPorts();
    const started = performance.now();
    const board = await createPixiBoard({
      headless: false,
      document,
      container: container as unknown as Element,
      interactions: { keyboard: true, clipboard: true, pointer: true },
      ports: {
        events: events as never,
        ticker,
        createResizeObserver: () => ({
          observe() { activeObservers += 1; },
          disconnect() { activeObservers -= 1; },
        }),
      },
      rendererFactory: (rendererOptions) => {
        renderer = new PixiBoardRenderer({
          ...rendererOptions,
          applicationFactory: () => app,
          viewFactory,
          acquireTexture: async () => {
            textureLeases += 1;
            let released = false;
            return {
              texture: {},
              release() {
                if (released) throw new Error("texture lease released more than once");
                released = true;
                textureLeases -= 1;
              },
            };
          },
        });
        return renderer;
      },
    });
    await board.ready;
    peakListeners = Math.max(peakListeners, events.count + container.count);
    peakTickers = Math.max(peakTickers, ticker.listeners.size);
    peakViews = Math.max(peakViews, renderer.activeViews.size);
    peakTextures = Math.max(peakTextures, textureLeases);
    await board.destroy();
    const residual = {
      listenerCount: events.count + container.count,
      tickerCount: ticker.listeners.size,
      observerCount: activeObservers,
      activeViewCount: renderer.activeViews.size,
      textureLeaseCount: textureLeases,
    };
    residuals.push(residual);
    samples.push({
      scenario: "create-destroy-soak",
      dataset: "lifecycle-image-fixture",
      iteration: cycle,
      durationMs: performance.now() - started,
      ...residual,
      longFrame: false,
    });
  }

  const final = residuals.at(-1) ?? { listenerCount: 0, tickerCount: 0, observerCount: 0, activeViewCount: 0, textureLeaseCount: 0 };
  return {
    status: "observed",
    observed: true,
    adapter: "pixiboardjs-facade+pixiboard-renderer-instrumented",
    scenario: "create-destroy-soak",
    dataset: "lifecycle-image-fixture",
    samples,
    summary: summarizeMetricSamples(samples),
    invariants: {
      cycles,
      peakListeners,
      peakTickers,
      peakViews,
      peakTextures,
      listenerBaseline: final.listenerCount,
      tickerBaseline: final.tickerCount,
      observerBaseline: final.observerCount,
      viewBaseline: final.activeViewCount,
      textureBaseline: final.textureLeaseCount,
      returnedToBaselineEveryCycle: residuals.every((value) => Object.values(value).every((count) => count === 0)),
    },
  } as Observation;
}

function environment() {
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model ?? "unknown";
  const fingerprint = [process.platform, process.arch, process.versions.node, cpuModel, cpuList.length, "instrumented-pixi-adapter"].join("|");
  return {
    fingerprint,
    runtime: "node" as const,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    cpuModel,
    cpuCount: cpuList.length,
    renderer: "instrumented-pixi-adapter" as const,
  };
}

function targetEvaluations(observations: Observation[]) {
  return observations.flatMap((observation) => {
    if (observation.status !== "observed") return [];
    if (observation.scenario === "core-single-node-update") {
      const value = observation.summary.p95CoreTransactionLatencyMs;
      return [{ scenario: observation.scenario, datasetCount: observation.datasetCount, target: "p95 < 2ms", observed: value, passed: typeof value === "number" && value < 2 }];
    }
    if (observation.scenario === "core-batch-update-1000") {
      const value = observation.summary.p95CoreTransactionLatencyMs;
      return [{ scenario: observation.scenario, datasetCount: observation.datasetCount, target: "p95 < 50ms", observed: value, passed: typeof value === "number" && value < 50 }];
    }
    if (observation.scenario === "renderer-culling") {
      return [{ scenario: observation.scenario, datasetCount: observation.datasetCount, target: "active views <= visible set * 1.5", observed: observation.samples[0]?.activeViewCount, passed: observation.invariants?.activeViewsBelow1_5xVisible === true }];
    }
    if (observation.scenario === "create-destroy-soak") {
      return [{ scenario: observation.scenario, target: "listener/ticker/view/texture return to baseline", observed: observation.invariants, passed: observation.invariants?.returnedToBaselineEveryCycle === true }];
    }
    return [];
  });
}

export async function runDeterministicBenchmark(options: HarnessOptions = {}) {
  const counts = options.counts ?? [...DEFAULT_COUNTS];
  const seed = options.seed ?? 42;
  const observations: Observation[] = [];
  let facadeDocument: BoardDocument | undefined;

  for (const count of counts) {
    let generated!: SyntheticDataset;
    const generation = await runScenario({
      adapter: {
        name: "synthetic-card-generator",
        "dataset-generation": () => {
          const durationMs = duration(() => { generated = generateSyntheticCards({ count, seed }); });
          return { durationMs, nodeCount: generated.nodes.length, seed };
        },
      },
      dataset: { name: "synthetic-card" },
      scenario: "dataset-generation",
      iterations: 1,
    });
    observations.push(observed(generation, count, { generatedNodeCount: generated.nodes.length, seed }));
    const document = toDocument(generated);
    if (!facadeDocument && count >= 10_000) facadeDocument = document;
    observations.push(...await runDatasetBenchmarks(generated, document, options));
  }

  if (options.includeFacadeBatch !== false) {
    if (!facadeDocument) {
      facadeDocument = toDocument(generateSyntheticCards({ count: 10_000, seed }));
    }
    observations.push(await runFacadeBatch(facadeDocument));
  }
  observations.push(await runLifecycleSoak(options.soakCycles ?? 100));

  const notObserved = [
    { metric: "browser/WebGL frame time p50/p95/p99 and >33ms ratio", reason: "Node instrumented renderer has no browser compositor or WebGL frame loop" },
    { metric: "GPU memory and draw calls/batches", reason: "instrumented display objects do not allocate GPU resources" },
    { metric: "idle CPU/GPU render activity", reason: "the Node harness has no requestAnimationFrame/ticker-driven render loop" },
    { metric: "1080p capture latency and culling preservation", reason: "requires a browser/WebGL extract implementation" },
    { metric: "JS heap regression", reason: "the process was not started with a controlled GC protocol; heap values would not be comparable" },
    { metric: "Konva comparison", reason: "no same-browser, same-device Konva fixture was executed" },
  ];

  return {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    environment: environment(),
    seed,
    deterministic: {
      counts,
      fixture: "LCG seed 42, fixed card size, fixed operation order and viewport path",
    },
    observations,
    targetEvaluations: targetEvaluations(observations),
    notObserved,
  };
}
