/**
 * Success criterion 1 (decision 10): a four-bar (2 ground pivots, 3 bars,
 * 4 R joints, fully assembled) is built through the rail and snapping
 * ONLY -- no Inspector, no typed dimensions -- in under 60s wall-clock and
 * <=12 interactions (clicks + keypresses).
 */
import { test, expect } from "@playwright/test";
import { clickCanvasPoint, distance, readSessionDocument, siteWorld } from "./helpers";

test("build a four-bar via the rail and snapping only, under 60s and <=12 interactions", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  let interactions = 0;
  async function click(world: { x: number; y: number }): Promise<void> {
    await clickCanvasPoint(page, world);
    interactions += 1;
  }
  async function clickTool(toolId: string): Promise<void> {
    await page.click(`[data-tool-id="${toolId}"]`);
    interactions += 1;
  }
  async function pressKey(key: string): Promise<void> {
    await page.keyboard.press(key);
    interactions += 1;
  }

  const t0 = Date.now();

  // 1. Ground pivot tool, two clicks -> one ground link, two sites.
  await clickTool("groundPivot");
  await click({ x: 0, y: 0 });
  await click({ x: 100, y: 0 });

  // 2. Bar tool: the status bar's idle hint is shown in Spanish before any draw.
  await clickTool("bar");
  await expect(page.getByRole("contentinfo")).toContainText("Haz clic para empezar una barra");

  // 3. CAD polyline chaining: (0,0) -> (20,40) -> (110,80) -> (100,0). The
  // first and last points snap onto the ground pivots placed above, so both
  // ends auto-pin (UX.md: "an end on an existing joint site creates a pin").
  await click({ x: 0, y: 0 });
  await click({ x: 20, y: 40 });
  await click({ x: 110, y: 80 });
  await click({ x: 100, y: 0 });

  // 4. End the chain (otherwise the next click would start a 4th bar).
  await pressKey("Escape");

  const elapsedMs = Date.now() - t0;
  // Recorded as a report annotation (visible in `npm run e2e`'s list
  // reporter output and 04-06-SUMMARY.md) -- the plan asks for the real
  // elapsed time and interaction count, not just the pass/fail booleans.
  testInfo.annotations.push(
    { type: "elapsedMs", description: String(elapsedMs) },
    { type: "interactions", description: String(interactions) },
  );

  expect(elapsedMs).toBeLessThan(60_000);
  expect(interactions).toBeLessThanOrEqual(12);

  const doc = await readSessionDocument(page);

  const groundLinks = doc.links.filter((l) => l.isGround);
  expect(groundLinks).toHaveLength(1);
  expect(groundLinks[0].sites).toHaveLength(2);
  const groundSiteIds = new Set(groundLinks[0].sites.map((s) => s.id));

  const movingLinks = doc.links.filter((l) => !l.isGround);
  expect(movingLinks).toHaveLength(3);
  for (const link of movingLinks) {
    expect(link.shape.kind).toBe("bar");
  }

  expect(doc.joints).toHaveLength(4);
  for (const joint of doc.joints) {
    expect(joint.type).toBe("R");
  }

  // Both ground sites are referenced by some joint (the two auto-pins).
  const jointSiteIds = new Set(doc.joints.flatMap((j) => [j.siteA, j.siteB]));
  for (const groundSiteId of groundSiteIds) {
    expect(jointSiteIds.has(groundSiteId)).toBe(true);
  }

  // Every joint is fully assembled: its two sites are world-coincident.
  for (const joint of doc.joints) {
    const a = siteWorld(doc, joint.siteA);
    const b = siteWorld(doc, joint.siteB);
    expect(distance(a, b)).toBeLessThan(1e-9);
  }
});
