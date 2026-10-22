/**
 * Joints anywhere on a link: a ground pivot clicked on a bar's middle pins
 * the bar there, a bar ending on another bar's body is pinned to it, and
 * one Pin click where two bars cross joins them at the crossing. Each new
 * joint point is a site added to the link, off the bar's drawn path.
 */
import { expect, test } from "@playwright/test";
import { clickCanvasPoint, distance, readSessionDocument, siteWorld } from "./helpers";

test("ground pivots, bar ends and pins attach anywhere on a bar", async ({ page }) => {
  await page.goto("/?lang=en");

  // A horizontal bar from (0,0) to (120,0), pinned to ground at its middle.
  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 0, y: 0 });
  await clickCanvasPoint(page, { x: 120, y: 0 });
  await page.keyboard.press("Escape");
  await page.click('[data-tool-id="groundPivot"]');
  await clickCanvasPoint(page, { x: 60, y: 2 });

  let doc = await readSessionDocument(page);
  expect(doc.joints).toHaveLength(1);
  const horizontal = doc.links.find((l) => !l.isGround)!;
  expect(horizontal.sites).toHaveLength(3);

  // A vertical bar from (30,-40) to (30,40) crosses it; its start lies on nothing.
  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 30, y: -40 });
  await clickCanvasPoint(page, { x: 30, y: 40 });
  await page.keyboard.press("Escape");
  doc = await readSessionDocument(page);
  expect(doc.joints).toHaveLength(1);

  // One Pin click at the crossing joins the two bars there.
  await page.click('[data-tool-id="pin"]');
  await clickCanvasPoint(page, { x: 31, y: 1 });
  doc = await readSessionDocument(page);
  expect(doc.joints).toHaveLength(2);
  const pin = doc.joints[1];
  const a = siteWorld(doc, pin.siteA);
  expect(distance(a, siteWorld(doc, pin.siteB))).toBeLessThan(1e-6);
  expect(distance(a, { x: 30, y: 0 })).toBeLessThan(1e-6);

  // A bar whose end lands on the vertical bar's body is pinned to it there.
  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 90, y: 60 });
  await clickCanvasPoint(page, { x: 31, y: 25 });
  await page.keyboard.press("Escape");
  doc = await readSessionDocument(page);
  expect(doc.joints).toHaveLength(3);
  const end = doc.joints[2];
  expect(distance(siteWorld(doc, end.siteA), siteWorld(doc, end.siteB))).toBeLessThan(1e-6);
  // On the vertical bar's line exactly, where the click (rounded to a screen pixel) landed.
  const onBar = siteWorld(doc, end.siteB);
  expect(Math.abs(onBar.x - 30)).toBeLessThan(1e-6);
  expect(Math.abs(onBar.y - 25)).toBeLessThan(0.5);
});
