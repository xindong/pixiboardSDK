import { expect, test } from "@playwright/test";

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
