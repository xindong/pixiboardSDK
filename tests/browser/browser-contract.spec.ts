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
