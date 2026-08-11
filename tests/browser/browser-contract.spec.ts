import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.goto("/?browser-contract=1");
  await expect(page.locator("#status")).toContainText("Loaded pixiboardjs exports:");
});

test("public browser surface loads without requesting Tauri modules", async ({ page }) => {
  const resources = await page.evaluate(() => (
    performance.getEntriesByType("resource").map((entry) => entry.name)
  ));
  expect(resources.some((url) => /tauri|@tauri-apps/i.test(url))).toBe(false);
});

test("native IndexedDB survives reload and enforces CAS plus quota recovery", async ({ page }) => {
  const databaseName = await page.evaluate(() => window.pixiBoardBrowserContracts.seedReloadContract());
  await page.reload();
  await expect(page.locator("#status")).toContainText("Loaded pixiboardjs exports:");
  await expect(page.evaluate((name) => (
    window.pixiBoardBrowserContracts.readReloadContract(name)
  ), databaseName)).resolves.toBe("before-reload");

  const result = await page.evaluate(() => window.pixiBoardBrowserContracts.runPersistenceContract());
  expect(result).toMatchObject({
    conflict: {
      successfulWrites: 1,
      rejectedWrites: 1,
      name: "BrowserDocumentConflictError",
      expectedRevision: 1,
      actualRevision: 2,
    },
    quota: {
      name: "BrowserStorageQuotaError",
      retryable: true,
      causeName: "QuotaExceededError",
    },
    finalMarker: "quota-retry",
  });
  expect(["first-writer", "second-writer"]).toContain(result.winnerMarker);
  expect(result.restoredMarker).toBe(result.winnerMarker);
  expect(result.afterQuotaMarker).toBe(result.winnerMarker);
});

test("reusable adapter contract closes native import, asset, recovery, export, and GC loops", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  const [result, download] = await Promise.all([
    page.evaluate(() => window.pixiBoardBrowserContracts.runNativeAdapterContract()),
    downloadPromise,
  ]);
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toBe("clip.mp4");
  expect(downloadPath).not.toBeNull();
  expect(await readFile(downloadPath!, "utf8")).toBe("video");
  expect(result).toMatchObject({
    transactionRevisions: [1, 2, 3, 4],
    derivativeText: "preview",
    objectUrlRevoked: true,
    export: { fileName: "clip.mp4", mimeType: "video/mp4", text: "video" },
    download: true,
    restored: { revision: 4 },
    gc: { quarantined: ["contract-audio"], deleted: ["contract-audio"] },
    recreated: true,
    capabilities: {
      indexedDb: true,
      opfs: true,
      blobFallback: true,
      desktopFileSystem: false,
    },
  });
  expect(result.imports).toEqual([
    { sourceType: "file", kind: "image", revision: 1, storage: "opfs" },
    { sourceType: "blob", kind: "video", revision: 2, storage: "indexeddb" },
    { sourceType: "text", kind: "text", revision: 3, storage: "indexeddb" },
    { sourceType: "url", kind: "audio", revision: 4, storage: "opfs" },
  ]);
  expect(result.restored.assetIds).toEqual([
    "contract-audio",
    "contract-image",
    "contract-text",
    "contract-video",
  ]);
  expect(result.restored.nodeTypes).toEqual(["audio", "image", "text", "video"]);
});

test("only the focused instance receives keyboard and clipboard events across destroy/recreate", async ({ page }) => {
  const result = await page.evaluate(() => window.pixiBoardBrowserContracts.runFocusClipboardContract());
  expect(result).toEqual({
    first: ["key:keydown", "clipboard:copy", "clipboard:cut", "clipboard:paste"],
    second: ["key:keydown", "clipboard:paste"],
    recreated: ["clipboard:copy"],
  });
});

test("real WebGL context loss and renderer init failure recover by recreation", async ({ page }) => {
  const result = await page.evaluate(() => window.pixiBoardBrowserContracts.runWebGlRecoveryContract());
  expect(
    result.contextResult.supported,
    String(result.contextResult.reason ?? "WebGL context loss contract failed"),
  ).toBe(true);
  expect(result).toMatchObject({
    contextResult: {
      defaultPrevented: true,
      replacementContexts: 1,
      activeAfterRecovery: true,
    },
    failureResult: {
      initialError: "injected renderer failure",
      activeAfterRecovery: true,
    },
  });
});

test("real Pixi/WebGL renderer accepts media-heavy Document nodes and returns all resources to baseline", async ({ page }) => {
  test.setTimeout(180_000);
  const result = await page.evaluate(() => window.pixiBoardBrowserContracts.runRendererAcceptanceContract());
  console.log("RENDERER_ACCEPTANCE_RESULT", JSON.stringify(result));
  expect(result.incremental.webgl).toBe(true);
  expect(result.incremental.initialKinds).toMatchObject({ image: "image", video: "video", audio: "audio", text: "text", custom: "contract.card" });
  expect(result.incremental.activeIds).toEqual(["custom", "image", "image-2", "text", "video"]);
  expect(result.incremental.text).toBe("renderer text v2");
  expect(result.incremental.customText).toBe("custom v2");
  expect(result.incremental.diagnosticsAfterDestroy).toMatchObject({ activeViews: 0, pendingOperations: 0, listeners: 0, tickers: 0, textureLeases: 0 });
  expect(result.incremental.textureBaseline).toBe(0);

  expect(result.previewRace.winningGeneration).toBe(2);
  expect(result.previewRace.beforeDestroy.active).toBe(1);
  expect(result.previewRace.afterDestroy).toMatchObject({ active: 0, diagnostics: { activeViews: 0, pendingOperations: 0, textureLeases: 0 } });
  expect(result.previewRace.afterDestroy.releases).toEqual(expect.arrayContaining(["race-preview:1", "race-preview:2"]));

  expect(result.dualInstance).toMatchObject({ isolatedTextures: true, secondSurvived: true });
  expect(result.dualInstance.firstBaseline).toMatchObject({ views: 0, textures: 0, diagnostics: { activeViews: 0, textureLeases: 0 } });
  expect(result.dualInstance.secondBaseline).toMatchObject({ views: 0, textures: 0, diagnostics: { activeViews: 0, textureLeases: 0 } });

  expect(result.mediaHeavy.map(({ images, videos }) => [images, videos])).toEqual([[100, 1], [500, 4], [2000, 8]]);
  for (const scale of result.mediaHeavy) {
    expect(scale.documentNodes).toBe(scale.images + scale.videos);
    expect(scale.distinctAssetRefs).toBe(scale.documentNodes);
    expect(scale.maxActiveViews).toBeLessThanOrEqual(scale.visibleLimit);
    expect(scale.destroyBaseline).toMatchObject({ views: 0, textures: 0, diagnostics: { activeViews: 0, pendingOperations: 0, textureLeases: 0, listeners: 0, tickers: 0 } });
  }

  expect(result.capture1080p).toMatchObject({ width: 1920, height: 1080, mimeType: "image/png", dataUrlPrefix: "data:image/png;base64," , activeSetPreserved: true });
  expect(result.capture1080p.latencyMs.p95).toBeLessThan(500);
  expect(result.capture1080p.destroyBaseline).toMatchObject({ views: 0, textures: 0, diagnostics: { activeViews: 0, textureLeases: 0 } });

  expect(result.destroySoak).toMatchObject({ cycles: 100, failures: [], finalCanvasCount: 0 });
  expect(result.notObserved).toEqual(expect.arrayContaining(["GPU memory", "draw calls/batches", "idle CPU/GPU"]));
});

test("DOM overlay layer pools elements, positions via transform and declutters by zoom", async ({ page }) => {
  const result = await page.evaluate(() => window.pixiBoardBrowserContracts.runOverlayLayerContract());

  // Positioning must never touch left/top: those force layout per item per frame.
  expect(result.usesTransformOnly).toBe(true);
  expect(result.renderedAtLeastOnce).toBe(true);

  // A pan moves the same elements rather than rebuilding the subtree.
  expect(result.pooledAcrossPan).toBe(true);
  expect(result.movedAcrossPan).toBe(true);

  // Declutter: collapse marks, minScale removes, and both are reversible.
  expect(result.collapsedCount).toBe(5);
  expect(result.scaledWhenClamped).toBe(true);
  expect(result.hiddenBelowMinScale).toBe(0);
  expect(result.restoredAfterZoomBack).toBe(5);
  expect(result.reusedFromPool).toBe(true);

  // Candidate culling narrows the layer; no candidate information means the
  // whole document, not an empty overlay.
  expect(result.culledCount).toBe(2);
  expect(result.unculledCount).toBe(5);

  // Culling is on by default via the board's visible set. On this board that
  // set is unknown, which must render everything rather than nothing.
  expect(result.boardReportsNoCulling).toBe(true);
  expect(result.defaultCandidateCount).toBe(5);

  // Several invalidations in one frame collapse into a single flush.
  expect(result.rendersPerFrame).toBe(5);

  // Destroy returns to baseline and detaches from the board.
  expect(result.beforeDestroy).toBe(5);
  expect(result.afterDestroy).toBe(0);
  expect(result.afterDestroyPan).toBe(0);
});
