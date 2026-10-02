/**
 * Success criterion 2: typing "120" then Enter while drawing a bar yields a
 * bar whose stored second site is EXACTLY [120, 0] (no floating rounding),
 * and Ctrl+Z removes it in one step.
 */
import { test, expect } from "@playwright/test";
import { clickCanvasPoint, readSessionDocument } from "./helpers";

test("typing '120' + Enter commits a bar with an exact [120,0] local site; Ctrl+Z removes it", async ({
  page,
}) => {
  await page.goto("/");

  // "l" selects the Bar tool.
  await page.keyboard.press("l");
  await clickCanvasPoint(page, { x: 0, y: 0 });
  await page.keyboard.type("120");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const doc = await readSessionDocument(page);
  const movingLinks = doc.links.filter((l) => !l.isGround);
  expect(movingLinks).toHaveLength(1);
  const link = movingLinks[0];
  expect(link.sites).toHaveLength(2);
  expect(link.sites[0].local).toEqual([0, 0]);
  expect(link.sites[1].local).toEqual([120, 0]);
  expect(
    Math.hypot(
      link.sites[1].local[0] - link.sites[0].local[0],
      link.sites[1].local[1] - link.sites[0].local[1],
    ),
  ).toBe(120);

  await page.keyboard.press("Control+z");
  const afterUndo = await readSessionDocument(page);
  expect(afterUndo.links.filter((l) => !l.isGround)).toHaveLength(0);
});

test("typing '120' Tab '30' + Enter commits a bar with pose.angle ~ 30deg", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("l");
  await clickCanvasPoint(page, { x: 0, y: 0 });
  await page.keyboard.type("120");
  await page.keyboard.press("Tab");
  await page.keyboard.type("30");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const doc = await readSessionDocument(page);
  const movingLinks = doc.links.filter((l) => !l.isGround);
  expect(movingLinks).toHaveLength(1);
  const link = movingLinks[0];
  expect(Math.abs(link.pose.angle - Math.PI / 6)).toBeLessThan(1e-12);
  expect(link.sites[1].local).toEqual([120, 0]);
});
