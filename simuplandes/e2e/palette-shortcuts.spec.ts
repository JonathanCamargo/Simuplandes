/**
 * Success criterion 4: the Ctrl+K command palette, every tool's single-key
 * shortcut, the `?` shortcut sheet, and Ctrl+K surviving an in-progress
 * draw (Esc isolation, proven end-to-end in a real browser).
 */
import { test, expect } from "@playwright/test";
import { TOOL_REGISTRY } from "../src/tools/registry";
import { clickCanvasPoint, readSessionDocument } from "./helpers";

test("Ctrl+K, type the pin label, Enter activates the Pin tool", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.type("pasador");
  await expect(page.getByRole("option", { name: /Pasador/ })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page.locator('[data-tool-id="pin"]')).toHaveAttribute("aria-pressed", "true");
});

test("every registry tool key presses the matching rail button", async ({ page }) => {
  await page.goto("/");

  for (const tool of TOOL_REGISTRY) {
    await page.keyboard.press(tool.key);
    await expect(page.locator(`[data-tool-id="${tool.id}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

test("'?' opens the shortcut sheet showing the Bar tool's row; Escape closes it", async ({
  page,
}) => {
  await page.goto("/");

  await page.keyboard.press("Shift+Slash");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Barra");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Ctrl+K during an in-progress bar draw does not cancel it (Esc isolation)", async ({
  page,
}) => {
  await page.goto("/");

  await page.keyboard.press("l");
  await clickCanvasPoint(page, { x: 0, y: 0 });

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // The draw survives: typing "50" + Enter still commits a 50-long bar.
  await page.keyboard.type("50");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const doc = await readSessionDocument(page);
  const movingLinks = doc.links.filter((l) => !l.isGround);
  expect(movingLinks).toHaveLength(1);
  expect(movingLinks[0].sites[1].local).toEqual([50, 0]);
});
