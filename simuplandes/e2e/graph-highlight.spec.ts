/**
 * Real-browser E2E for SC-2 (GRF-02): two-way hover (graph <-> canvas) and
 * shared selection, including hover while in Simulate mode. Every test
 * collects `pageerror` events and asserts there are none.
 *
 * `canvasHalo` is a local `page.evaluate` wrapper around the DEV-only
 * `window.__simuplandesCanvas` hook (06-03), modeled on `helpers.ts`'s own
 * `simHook`/`getSimTrace` pattern -- per this plan's phase rules, `helpers.ts`
 * itself is never edited.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  canvasPoint,
  clickCanvasPoint,
  loadExampleFourBar,
  pointOnLink,
  pressSpace,
  readSessionDocument,
  siteWorld,
} from "./helpers";
import type { CanvasHaloState } from "../src/canvas/layers/canvasTestHook";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

async function canvasHalo(page: Page, id: string): Promise<CanvasHaloState | null> {
  return page.evaluate((entityId: string) => {
    const hook = window.__simuplandesCanvas;
    if (!hook) {
      throw new Error(
        "window.__simuplandesCanvas is not installed -- the DEV-only canvas test hook is missing (is this a production build?)",
      );
    }
    return hook.haloState(entityId);
  }, id);
}

/**
 * `loadExampleFourBar`'s File menu leaves a transient MUI `Backdrop` in the
 * DOM (opacity fading to 0 over its exit transition) that still intercepts
 * pointer hit-testing across the whole viewport until it fully detaches --
 * waiting it out here (once) avoids every subsequent hover/click in this
 * file racing it, matching `i18n-theme.spec.ts`'s own documented precedent
 * for MUI's Menu/Popover exit transitions.
 */
async function openGraphWithExampleFourBar(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();
  await loadExampleFourBar(page);
  await page.locator(".MuiBackdrop-root").waitFor({ state: "detached" });
}

test("Hovering a graph node highlights its link on the canvas", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await openGraphWithExampleFourBar(page);
  const doc = await readSessionDocument(page);
  const crank = doc.links.find((l) => l.name === "crank")!;
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  const rocker = doc.links.find((l) => l.name === "rocker")!;
  const ground = doc.links.find((l) => l.name === "ground")!;

  await page.locator(`[data-node-id="${crank.id}"]`).hover();
  await expect.poll(async () => (await canvasHalo(page, crank.id))?.hovered).toBe(true);
  for (const other of [coupler, rocker, ground]) {
    await expect.poll(async () => (await canvasHalo(page, other.id))?.hovered).toBe(false);
  }

  await page.mouse.move(0, 0);
  await expect.poll(async () => (await canvasHalo(page, crank.id))?.hovered).toBe(false);

  expect(pageErrors).toEqual([]);
});

test("Hovering a link on the canvas highlights its graph node", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await openGraphWithExampleFourBar(page);
  const doc = await readSessionDocument(page);
  const crank = doc.links.find((l) => l.name === "crank")!;
  const jointA = doc.joints.find((j) => j.name === "A")!;

  const p0 = siteWorld(doc, crank.sites[0].id);
  const p1 = siteWorld(doc, crank.sites[1].id);
  const crankMidpoint = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const point = await canvasPoint(page, crankMidpoint);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(`[data-node-id="${crank.id}"]`)).toHaveAttribute(
    "data-hovered",
    "true",
  );

  const pinPoint = siteWorld(doc, jointA.siteA);
  const pinScreen = await canvasPoint(page, pinPoint);
  await page.mouse.move(pinScreen.x, pinScreen.y);
  await expect(page.locator(`[data-edge-id="${jointA.id}"]`)).toHaveAttribute(
    "data-hovered",
    "true",
  );

  expect(pageErrors).toEqual([]);
});

test("Selection is shared both ways", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await openGraphWithExampleFourBar(page);
  const doc = await readSessionDocument(page);
  const rocker = doc.links.find((l) => l.name === "rocker")!;
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  const jointB = doc.joints.find((j) => j.name === "B")!;

  await page.locator(`[data-node-id="${rocker.id}"]`).click();
  await expect.poll(async () => (await canvasHalo(page, rocker.id))?.selected).toBe(true);

  await page.getByRole("tab", { name: "Inspector" }).click();
  await expect(page.getByLabel("Nombre")).toHaveValue("rocker");

  if (coupler.shape.kind !== "plate") throw new Error("expected coupler to be a plate");
  const outline = coupler.shape.outline;
  const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length;
  const cy = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
  const couplerCentroid = pointOnLink(null, doc, coupler.id, { x: cx, y: cy });
  await clickCanvasPoint(page, couplerCentroid);

  await page.getByRole("tab", { name: "Grafo" }).click();
  await expect(page.locator(`[data-node-id="${coupler.id}"]`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.locator(`[data-node-id="${rocker.id}"]`)).toHaveAttribute(
    "data-selected",
    "false",
  );

  await page.locator(`[data-edge-id="${jointB.id}"]`).click();
  await expect.poll(async () => (await canvasHalo(page, jointB.id))?.selected).toBe(true);

  expect(pageErrors).toEqual([]);
});

test("Hover works in Simulate too", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await openGraphWithExampleFourBar(page);
  const doc = await readSessionDocument(page);
  const crank = doc.links.find((l) => l.name === "crank")!;

  await pressSpace(page);
  await page.getByRole("button", { name: "Reproducir" }).click();
  await page.locator(`[data-node-id="${crank.id}"]`).hover();
  await expect.poll(async () => (await canvasHalo(page, crank.id))?.hovered).toBe(true);

  await page.getByRole("button", { name: "Pausar" }).click();
  await page.locator(`[data-node-id="${crank.id}"]`).hover();
  await expect.poll(async () => (await canvasHalo(page, crank.id))?.hovered).toBe(true);

  expect(pageErrors).toEqual([]);
});
