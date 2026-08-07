import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/check-performance-gate.mjs <pr|nightly|rc>');
  process.exit(0);
}
const profile = process.argv[2];
if (!['pr', 'nightly', 'rc'].includes(profile)) throw new Error('performance gate profile must be pr, nightly or rc');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = resolve(process.env.PIXIBOARD_PERFORMANCE_DIR ?? `.artifacts/performance/${profile}`);
const nodeReportPath = join(artifactDir, 'node.json');
const browserReportPath = join(artifactDir, 'browser.json');
const summaryPath = join(artifactDir, 'summary.json');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
await mkdir(artifactDir, { recursive: true });

for (const packageName of ['@pixi-board/core', 'pixiboardjs']) {
  const buildCode = await run(pnpm, ['--filter', packageName, 'build']);
  if (buildCode !== 0) throw new Error(`${packageName} build exited ${buildCode}`);
}
const benchmarkScript = profile === 'pr' ? 'benchmark:report' : 'benchmark:run';
const benchmarkCode = await run(pnpm, ['--filter', 'pixiboardjs-benchmark', benchmarkScript], { PIXIBOARD_BENCHMARK_REPORT: nodeReportPath });
if (benchmarkCode !== 0) throw new Error(`benchmark command exited ${benchmarkCode}`);
const nodeReport = JSON.parse(await readFile(nodeReportPath, 'utf8'));
const blockers = [];
blockers.push(...validateNodeReport(nodeReport));
let browserReport = null;
if (profile !== 'pr') {
  browserReport = await runBrowserBenchmark(browserReportPath);
  blockers.push(...browserReport.blockers);
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  profile,
  passed: blockers.length === 0,
  blockers: [...new Set(blockers)],
  evidence: { node: 'node.json', browser: browserReport ? 'browser.json' : null },
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
if (summary.blockers.length) {
  console.error(`Performance ${profile} gate failed:`);
  for (const blocker of summary.blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else console.log(`Performance ${profile} gate passed with ${nodeReport?.observations?.length ?? 0} Node observations${browserReport ? ', Chromium WebGL/media soak and Konva visible-set reference evidence' : ''}.`);

function validateNodeReport(report) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push('Node report schemaVersion must be 1');
  if (!report?.environment?.fingerprint || report?.environment?.runtime !== 'node') failures.push('Node runtime fingerprint is missing or invalid');
  if (!Array.isArray(report?.observations) || !report.observations.length) failures.push('Node observations are missing');
  for (const observation of report?.observations ?? []) {
    if (observation.status !== 'observed' || !Array.isArray(observation.samples) || !observation.samples.length || !observation.summary?.observed) failures.push(`Node observation ${observation.scenario ?? 'unknown'}/${observation.datasetCount ?? 'all'} is not observed`);
  }
  for (const target of report?.targetEvaluations ?? []) if (target.passed !== true) failures.push(`Node target failed: ${target.scenario}/${target.datasetCount ?? 'all'} (${target.target})`);
  if (profile !== 'pr') {
    for (const count of [10_000, 50_000, 100_000]) {
      const spatial = report?.observations?.find((item) => item.scenario === 'spatial-rebuild' && item.datasetCount === count);
      if (spatial?.invariants?.indexedNodeCount !== count) failures.push(`Node report did not index all ${count} nodes`);
    }
    const soak = report?.observations?.find((item) => item.scenario === 'create-destroy-soak');
    if (soak?.invariants?.cycles !== 100 || soak?.invariants?.returnedToBaselineEveryCycle !== true) failures.push('Node gate requires a passing 100-cycle SDK create/destroy soak');
  }
  return failures;
}

async function runBrowserBenchmark(reportPath) {
  const counts = [10_000, 50_000, 100_000];
  const fixtureParent = resolve(root, 'packages/renderer-pixi/temp');
  await mkdir(fixtureParent, { recursive: true });
  const fixtureDir = await mkdtemp(join(fixtureParent, 'browser-benchmark-'));
  const port = 4_179;
  let server;
  try {
    await writeFixture(fixtureDir);
    await downloadKonva(fixtureDir);
    server = startVite(fixtureDir, port);
    await waitForServer(`http://127.0.0.1:${port}`);
    const evidence = await runChromium(`http://127.0.0.1:${port}`, counts);
    const browserBlockers = evaluateBrowserEvidence(evidence, counts);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: evidence.environment,
      comparison: {
        datasetCounts: counts,
        scope: 'Candidate validates/indexes the full source document; Konva is a same-visible-set Canvas2D reference. Cross-engine cold timings are not comparable.',
        observations: evidence.observations,
        targetEvaluations: evidence.targetEvaluations,
      },
      mediaSoak: evidence.mediaSoak,
      notObserved: ['hardware-GPU throughput (CI may use SwiftShader)', 'GPU memory', 'draw calls/batches', 'full-document Konva indexing/culling equivalence'],
      passed: browserBlockers.length === 0,
      blockers: browserBlockers,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    server?.kill('SIGTERM');
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

async function writeFixture(directory) {
  const coreUrl = `/@fs${resolve(root, 'packages/core/src/index.ts')}`;
  const rendererUrl = `/@fs${resolve(root, 'packages/renderer-pixi/src/index.ts')}`;
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body style="margin:0;background:#111"><div id="host"></div><script type="module" src="/main.js"></script></body></html>\n');
  await writeFile(join(directory, 'main.js'), browserFixtureSource(coreUrl, rendererUrl));
  await writeFile(join(directory, 'vite.config.mjs'), `export default { server: { fs: { allow: [${JSON.stringify(root)}, ${JSON.stringify(directory)}] } } };\n`);
}

async function downloadKonva(directory) {
  const response = await fetch('https://cdn.jsdelivr.net/npm/konva@10.3.0/konva.min.js');
  if (!response.ok) throw new Error(`Konva 10.3.0 download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha384').update(data).digest('base64');
  const expected = '0J5jG861IV4dbTNYz2dMoeFDc1s4wgpL1jPYCFnyz1vJmVikJ3dERasAfv2Xjeo2';
  if (digest !== expected) throw new Error(`Konva 10.3.0 integrity mismatch: ${digest}`);
  await writeFile(join(directory, 'konva.min.js'), data);
}

function startVite(directory, port) {
  const vite = resolve(root, 'apps/examples-vanilla/node_modules/.bin/vite');
  const child = spawn(vite, [directory, '--config', join(directory, 'vite.config.mjs'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Vite benchmark fixture did not start at ${url}`);
}

async function runChromium(url, counts) {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--js-flags=--expose-gc'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1_920, height: 1_080 }, deviceScaleFactor: 1 });
    await page.goto(url);
    await page.addScriptTag({ url: `${url}/konva.min.js` });
    await page.waitForFunction(() => Boolean(window.runCandidateBenchmark && window.Konva));
    return await page.evaluate((requestedCounts) => window.runCandidateBenchmark(requestedCounts), counts);
  } finally { await browser.close(); }
}

function evaluateBrowserEvidence(evidence, counts) {
  const failures = [];
  for (const count of counts) {
    const candidate = evidence.observations.find((item) => item.renderer === 'pixiboard-candidate' && item.datasetCount === count);
    const konva = evidence.observations.find((item) => item.renderer === 'konva' && item.datasetCount === count);
    if (!candidate) failures.push(`missing candidate observation for ${count} nodes`);
    if (!konva) failures.push(`missing Konva visible-set reference for ${count} nodes`);
    if (candidate?.webgl !== true) failures.push(`candidate ${count}-node observation did not use WebGL`);
    if (candidate?.indexedNodeCount !== count) failures.push(`candidate ${count}-node observation did not index the full document`);
    if (candidate?.visibleSetChurnObserved !== true) failures.push(`candidate ${count}-node pan did not change the active visible set`);
    for (const observation of [candidate, konva]) if (observation && ![observation.coldMs, observation.steadyFrameP50Ms, observation.steadyFrameP95Ms, observation.steadyFrameP99Ms, observation.longFrameRatio].every(Number.isFinite)) failures.push(`${observation.renderer} ${count}-node timing evidence is incomplete`);
  }
  for (const target of evidence.targetEvaluations ?? []) if (target.passed !== true) failures.push(`browser target failed: ${target.scenario}/${target.datasetCount} (${target.target}, observed ${target.observed})`);
  const soak = evidence.mediaSoak;
  if (soak.cycles !== 100 || soak.decodedImages !== soak.cycles * soak.imagesPerCycle) failures.push('candidate media soak did not complete 100 fully decoded cycles');
  if (soak.webgl !== true) failures.push('candidate media soak did not use WebGL');
  if (soak.returnedToBaselineEveryCycle !== true) failures.push('candidate media soak left views or texture leases after a cycle');
  return failures;
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.on('error', (error) => { console.error(error); resolveExit(1); });
    child.on('exit', (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
  });
}

function browserFixtureSource(coreUrl, rendererUrl) {
  return `
import { createBoardCore } from ${JSON.stringify(coreUrl)};
import { PixiBoardRenderer } from ${JSON.stringify(rendererUrl)};
import { Application, Texture, VERSION as PIXI_VERSION } from "pixi.js";
const viewport = { width: 1920, height: 1080, dpr: 1 };
const visibleCountFor = (count) => count === 10000 ? 200 : 300;
const percentile = (values, rank) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * rank) - 1)] ?? null;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
function makeNodes(count) { const visibleCount = visibleCountFor(count); return Array.from({ length: count }, (_, index) => ({ id: \`node-\${index}\`, type: "rect", typeVersion: 1, x: index < visibleCount ? (index % 20) * 80 : 100000 + ((index * 7919) % 900000), y: index < visibleCount ? Math.floor(index / 20) * 70 : 100000 + ((index * 104729) % 900000), width: 64, height: 48, rotation: 0, zIndex: index, props: { fill: 0x4c8dff } })); }
function application(host) { const app = new Application(); const init = app.init.bind(app); app.init = async (options) => { await init(options); host.appendChild(app.canvas); }; return app; }
async function candidateSample(count) {
  const host = document.querySelector("#host"), value = { schemaVersion: 1, revision: 0, nodes: makeNodes(count), assets: [] }, started = performance.now(), core = createBoardCore({ document: value }), snapshot = core.document.snapshot(), app = application(host), renderer = new PixiBoardRenderer({ applicationFactory: () => app });
  await renderer.init(); await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height }); await renderer.rebuild(snapshot); app.render(); await nextFrame();
  const coldMs = performance.now() - started, frames = [], activeCounts = [];
  for (let step = 0; step < 20; step += 1) { const frameStarted = performance.now(), offset = step % 2 ? 80 : 0; await renderer.setVisibleBounds({ minX: offset, minY: 0, maxX: viewport.width + offset, maxY: viewport.height }); app.render(); frames.push(performance.now() - frameStarted); activeCounts.push(renderer.diagnostics.activeViews); await nextFrame(); }
  let indexedNodeCount = 0; for (const node of snapshot.nodes) if ([...renderer.spatialIndex.queryPoint({ x: node.x + 1, y: node.y + 1 })].includes(node.id)) indexedNodeCount += 1;
  const result = summary("pixiboard-candidate", count, coldMs, frames, Math.max(...activeCounts), Boolean(app.renderer?.gl), indexedNodeCount); result.visibleSetChurnObserved = new Set(activeCounts).size > 1; await renderer.destroy(); return result;
}
async function konvaSample(count) {
  const host = document.querySelector("#host"), element = document.createElement("div"); host.appendChild(element); const nodes = makeNodes(count), visibleCount = visibleCountFor(count), started = performance.now(), stage = new window.Konva.Stage({ container: element, width: viewport.width, height: viewport.height }), layer = new window.Konva.Layer(); stage.add(layer);
  for (let index = 0; index < visibleCount; index += 1) { const node = nodes[index]; layer.add(new window.Konva.Rect({ x: node.x, y: node.y, width: node.width, height: node.height, fill: "#4c8dff" })); }
  layer.draw(); await nextFrame(); const coldMs = performance.now() - started, frames = [];
  for (let step = 0; step < 20; step += 1) { const frameStarted = performance.now(), offset = step % 2 ? 80 : 0; layer.position({ x: -offset, y: 0 }); layer.draw(); frames.push(performance.now() - frameStarted); await nextFrame(); }
  stage.destroy(); element.remove(); return summary("konva", count, coldMs, frames, visibleCount, false, null);
}
function summary(renderer, count, coldMs, frames, activeObjectCount, webgl, indexedNodeCount) { return { renderer, datasetCount: count, retentionMode: "matched-visible", viewport: "1920x1080@1", coldMs, steadyFrameP50Ms: percentile(frames, .5), steadyFrameP95Ms: percentile(frames, .95), steadyFrameP99Ms: percentile(frames, .99), longFrameRatio: frames.filter((value) => value > 33).length / frames.length, activeObjectCount, indexedNodeCount, webgl }; }
async function mediaSoak() {
  const host = document.querySelector("#host"), app = application(host); let decodedImages = 0, liveLeases = 0;
  const renderer = new PixiBoardRenderer({ applicationFactory: () => app, acquireTexture: async (ref) => { const image = new Image(); image.src = ref.source; await image.decode(); decodedImages += 1; liveLeases += 1; const texture = Texture.from(image); let released = false; return { texture, release() { if (released) throw new Error("texture released twice"); released = true; liveLeases -= 1; texture.destroy(true); image.src = ""; } }; } });
  await renderer.init(); await renderer.setVisibleBounds({ minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height }); const cycles = 100, imagesPerCycle = 8, durations = []; let returnedToBaselineEveryCycle = true;
  for (let cycle = 0; cycle < cycles; cycle += 1) { const started = performance.now(), nodes = Array.from({ length: imagesPerCycle }, (_, index) => { const hue = (cycle * 37 + index * 53) % 360, svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(\${hue} 70% 45%)"/></svg>\`; return { id: \`media-\${cycle}-\${index}\`, type: "image", typeVersion: 1, x: (index % 4) * 280, y: Math.floor(index / 4) * 280, width: 256, height: 256, rotation: 0, zIndex: index, assetRefs: { image: { assetId: \`asset-\${cycle}-\${index}\`, source: \`data:image/svg+xml;charset=utf-8,\${encodeURIComponent(svg)}\` } }, props: {} }; }); await renderer.rebuild({ schemaVersion: 1, revision: cycle * 2, nodes, assets: [] }); app.render(); await nextFrame(); await renderer.rebuild({ schemaVersion: 1, revision: cycle * 2 + 1, nodes: [], assets: [] }); app.render(); returnedToBaselineEveryCycle &&= renderer.diagnostics.activeViews === 0 && renderer.diagnostics.textureLeases === 0 && liveLeases === 0; durations.push(performance.now() - started); }
  const webgl = Boolean(app.renderer?.gl); await renderer.destroy(); return { scenario: "candidate-browser-image-texture-soak", cycles, imagesPerCycle, decodedImages, webgl, returnedToBaselineEveryCycle, p95CycleMs: percentile(durations, .95), maxCycleMs: Math.max(...durations) };
}
window.runCandidateBenchmark = async (counts) => { const observations = []; for (const count of counts) { observations.push(await candidateSample(count)); observations.push(await konvaSample(count)); } const candidate = (count) => observations.find((item) => item.renderer === "pixiboard-candidate" && item.datasetCount === count); const targetEvaluations = [ { scenario: "browser-pan", datasetCount: 10000, target: "p95 <= 16.7ms", observed: candidate(10000).steadyFrameP95Ms, passed: candidate(10000).steadyFrameP95Ms <= 16.7 }, { scenario: "browser-pan", datasetCount: 50000, target: "p95 <= 20ms", observed: candidate(50000).steadyFrameP95Ms, passed: candidate(50000).steadyFrameP95Ms <= 20 }, { scenario: "browser-first-interactive", datasetCount: 100000, target: "<= 2000ms", observed: candidate(100000).coldMs, passed: candidate(100000).coldMs <= 2000 }, ...counts.map((count) => ({ scenario: "active-views", datasetCount: count, target: "<= visible * 1.5", observed: candidate(count).activeObjectCount, passed: candidate(count).activeObjectCount <= visibleCountFor(count) * 1.5 })) ]; return { environment: { browser: navigator.userAgent, viewport, renderer: "candidate PixiBoard Core + renderer-pixi WebGL / Konva 10.3.0 Canvas2D", pixiVersion: PIXI_VERSION, konvaVersion: window.Konva.version }, observations, targetEvaluations, mediaSoak: await mediaSoak() }; };
`;
}
