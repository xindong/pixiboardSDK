import { expect, test } from "@playwright/test";

/**
 * The live demo consumes the SDK's selection and label overlays exactly as an
 * external host would. These assertions guard the migration away from the
 * hand-written overlay code the demo used to carry.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
});

test("demo draws selection outlines and a group box through the SDK overlay", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  const outlineSelector = ".pixiboard-selection-outline";
  // Click a seeded card the way a user would; the demo exposes no test hook.
  // The overlay flushes on requestAnimationFrame, so the assertion has to wait
  // for a real frame rather than reading the DOM synchronously.
  await page.mouse.click(300, 300);
  await expect(page.locator(outlineSelector).first()).toBeVisible({ timeout: 5_000 });

  const single = await page.evaluate(() => ({
    outlines: document.querySelectorAll(".pixiboard-selection-outline").length,
    bbox: document.querySelectorAll(".pixiboard-selection-bbox").length,
    // The old hand-written classes must be gone entirely.
    staleOutline: document.querySelectorAll(".selection-outline").length,
    staleBbox: document.querySelectorAll(".selection-bbox").length,
  }));

  expect(single.staleOutline).toBe(0);
  expect(single.staleBbox).toBe(0);
  expect(single.outlines).toBeGreaterThan(0);
  // One node selected: an outline but no group box.
  expect(single.bbox).toBe(0);

  const outline = page.locator(outlineSelector).first();
  // Positioning goes through transform, and the outline is sized in screen
  // pixels so its border thickness never scales with zoom.
  const style = await outline.evaluate((element) => ({
    transform: (element as HTMLElement).style.transform,
    width: (element as HTMLElement).style.width,
    left: (element as HTMLElement).style.left,
  }));
  expect(style.transform).toContain("translate3d(");
  expect(style.width).not.toBe("");
  expect(["0px", "0", ""]).toContain(style.left);

  // Shift-click a second card: two outlines plus the group bounding box.
  await page.keyboard.down("Shift");
  await page.mouse.click(300, 420);
  await page.keyboard.up("Shift");
  await expect(page.locator(".pixiboard-selection-bbox")).toHaveCount(1);
  expect(await page.locator(outlineSelector).count()).toBe(2);

  // Deselecting must take the group box away with it.
  await page.mouse.click(1100, 650);
  await expect(page.locator(".pixiboard-selection-bbox")).toHaveCount(0);
  await expect(page.locator(outlineSelector)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("demo labels media nodes through the SDK label overlay", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // No media in the seeded document, so no labels to begin with.
  expect(await page.locator(".media-label").count()).toBe(0);

  // Import a real image the same way a user drop would.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#7c8cf8";
    context.fillRect(0, 0, 32, 32);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    const file = new File([blob], "cover.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.querySelector("#board-host")!.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });

  const label = page.locator(".media-label").first();
  await expect(label).toBeVisible({ timeout: 10_000 });
  await expect(label).toContainText("cover.png");

  const style = await label.evaluate((element) => ({
    transform: (element as HTMLElement).style.transform,
    left: (element as HTMLElement).style.left,
  }));
  expect(style.transform).toContain("translate3d(");
  expect(["0px", "0", ""]).toContain(style.left);

  // The old hand-written badge classes are gone.
  expect(await page.locator(".media-badge").count()).toBe(0);
  expect(errors).toEqual([]);
});
