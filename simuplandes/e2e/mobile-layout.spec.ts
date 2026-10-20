/**
 * The compact (phone) layout in a real browser: a touch phone viewport gets
 * the compact shell automatically, the dock opens as a sheet, Simulate gets
 * its transport, two fingers pinch-zoom and pan the canvas, and a phone in
 * landscape keeps the side rail. Screenshots land in `test-results/mobile/`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readSessionDocument } from "./helpers";

const SHOTS = "test-results/mobile";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function readViewport(page: Page): Promise<{ zoom: number; panX: number; panY: number }> {
  const json = await page.locator('[data-testid="canvas-area"]').getAttribute("data-viewport");
  if (!json) throw new Error("canvas-area has no data-viewport");
  return JSON.parse(json) as { zoom: number; panX: number; panY: number };
}

/** Two-finger gesture through CDP: fingers start `from` apart around `center` and end `to` apart. */
async function pinch(
  page: Page,
  center: { x: number; y: number },
  from: number,
  to: number,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (gap: number) => [
    { x: center.x - gap / 2, y: center.y, id: 1 },
    { x: center.x + gap / 2, y: center.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(from + ((to - from) * i) / steps),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?lang=en&theme=light");
  await expect(page.locator('[data-testid="canvas-area"] canvas').first()).toBeVisible();
});

test("a phone gets the compact shell and the dock as a sheet", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "File" })).toHaveCount(0);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Transport" })).toHaveCount(0);

  // Nothing overflows the phone's width.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${SHOTS}/portrait-build.png` });

  await page.getByRole("button", { name: "Panel" }).tap();
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/portrait-dock.png` });
  await page.getByRole("button", { name: "Close panel" }).tap();
  await expect(page.getByRole("complementary")).toHaveCount(0);

  await page.getByRole("button", { name: "Menu" }).tap();
  await page.screenshot({ path: `${SHOTS}/portrait-menu.png` });
  await page.getByRole("menuitem", { name: "Load example four-bar" }).tap();
  await page.getByRole("button", { name: "Simulate" }).tap();
  await expect(page.getByRole("region", { name: "Transport" })).toBeVisible();
  await page.getByRole("button", { name: /Plots/ }).tap();
  await page.screenshot({ path: `${SHOTS}/portrait-simulate.png` });
});

test("two fingers pinch-zoom and pan the canvas", async ({ page }) => {
  // A mechanism first: on an empty drawing the examples card covers the middle of a phone.
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "Load example four-bar" }).tap();
  // The closing menu's backdrop takes touches until its exit transition ends.
  await page.locator(".MuiMenu-root").waitFor({ state: "detached" });
  const linksBefore = (await readSessionDocument(page)).links.length;

  const box = await page.locator('[data-testid="canvas-area"]').boundingBox();
  if (!box) throw new Error("canvas-area has no box");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const before = await readViewport(page);
  await pinch(page, center, 80, 240);
  await expect.poll(async () => (await readViewport(page)).zoom).toBeGreaterThan(before.zoom * 2);

  const zoomed = await readViewport(page);
  await pinch(page, center, 240, 80);
  await expect.poll(async () => (await readViewport(page)).zoom).toBeLessThan(zoomed.zoom / 2);

  // The pinch never reached the tools: the drawing is unchanged.
  expect((await readSessionDocument(page)).links.length).toBe(linksBefore);
});

test("landscape keeps the side rail", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Tools" });
  await expect(rail.locator(".MuiToggleButtonGroup-vertical")).toHaveCount(1);
  await page.getByRole("button", { name: "Panel" }).tap();
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/landscape-dock.png` });
});

test("the layout preference overrides the viewport", async ({ page }) => {
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitemradio", { name: "Desktop" }).tap();
  await expect(page.getByRole("button", { name: "File" })).toBeVisible();
  await expect(page.getByRole("complementary")).toBeVisible();
});
