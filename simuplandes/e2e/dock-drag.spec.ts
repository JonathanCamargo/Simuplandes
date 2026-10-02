/**
 * Regression test for a real bug found while building dock-layout.spec.ts's
 * separator-drag test: `StudioShell.tsx` used to pass the LIVE `dockSizePct`
 * (from the preferences store, updated on every `onResize` during a drag)
 * straight into the dock/canvas Panels' `defaultSize` prop. Because the dock
 * Panel has an `onResize` handler, react-resizable-panels registers a
 * ResizeObserver on its element; a real drag fires MANY pointermove events
 * (not just one), each committing a new layout in "panel" resize-preview
 * mode, each triggering `onResize` -> `setDockSizePct` -> a re-render that
 * passes a NEW `defaultSize` down to the Panel. That re-derives the panel's
 * constraints mid-drag and effectively resets the drag's reference point on
 * every single event, so the NET effect of an N-step drag becomes only
 * "total distance / N" instead of the full distance -- i.e. dragging felt
 * almost frozen for a real user (whose OS fires dozens of pointermove
 * events per drag), even though a single-jump `mouse.move` (one event, as
 * in a naive test) looked fine. Fixed by capturing the dock size ONCE at
 * mount (`useState(dockSizePct)`, matching react-resizable-panels' own
 * "defaultSize is like defaultValue, not a controlled value" contract) and
 * only ever writing dockSizePct forward via `onResize`, never reading it
 * back into `defaultSize` after the initial render.
 *
 * This is a leftover debugging probe (see 04-07-SUMMARY.md's "Left for the
 * user to delete" -- a local hook blocks deleting it, matching the four
 * `e2e/debug{,2,3}.spec.ts` probes from 04-06), kept as a real regression
 * test rather than scratch, per the same policy 04-06 established.
 */
import { test, expect } from "@playwright/test";

test("a many-event drag (not just a single jump) resizes the dock by the full distance", async ({
  page,
}) => {
  await page.goto("/");
  const dockLocator = page.getByRole("complementary");
  await expect(dockLocator).toBeVisible();
  const before = await dockLocator.boundingBox();
  const separator = page.getByRole("separator");
  const sepBox = await separator.boundingBox();
  if (!sepBox || !before) throw new Error("no bounding box");

  const startX = sepBox.x + sepBox.width / 2;
  const startY = sepBox.y + sepBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Many intermediate pointermove events, like a real OS-level drag -- this
  // is exactly the case that used to be broken (see header comment).
  await page.mouse.move(startX - 150, startY, { steps: 30 });
  await page.mouse.up();

  const after = await dockLocator.boundingBox();
  if (!after) throw new Error("no bounding box after drag");
  // Before the fix this was ~5px (150 / 30 steps); it should be ~150px.
  expect(after.width - before.width).toBeGreaterThan(100);
});
