/**
 * Real-browser E2E for SC-2 ("Dragging the coupler of a four-bar moves the
 * whole linkage without breaking joints") and research Pitfall 1 (a drag
 * controller that hit-tests the reference pose, not the simulated one,
 * would grab nothing at a scrubbed pose). Every test collects `pageerror`
 * events and asserts there are none.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  canvasPoint,
  dragCanvas,
  getSimInput,
  getSimPoses,
  loadExampleFourBar,
  maxJointResidual,
  pointOnLink,
  pressSpace,
  readSessionDocument,
  seedDocument,
  type SimPoseMap,
} from "./helpers";
import { createMechanismStore, buildExampleFourBar } from "../src/store";
import type { MechanismDocument } from "../src/model";

/** A fresh `buildExampleFourBar` document, built through a scratch, in-memory `MechanismStore`
 * (never through `src/kinematics`, which the seam forbids outside `src/sim/**`). */
function buildFourBarDocument(): MechanismDocument {
  const store = createMechanismStore();
  buildExampleFourBar(store);
  return store.getState().document;
}

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

/** The coupler-local grab point 30% of the way from site A to site B, offset a few mm toward
 * the plate's own apex so the point sits well inside the triangle body (not exactly on the A-B
 * edge, which the plate's outline treats as its own boundary) -- the plate BODY per SC-2's own
 * wording, not the marker (which sits at the apex). */
function couplerLocalGrab(doc: MechanismDocument, couplerId: string): { x: number; y: number } {
  const coupler = doc.links.find((l) => l.id === couplerId)!;
  const jointA = doc.joints.find((j) => j.name === "A")!;
  const jointB = doc.joints.find((j) => j.name === "B")!;
  const siteA = coupler.sites.find((s) => s.id === jointA.siteB)!; // coupler's own site at A
  const siteB = coupler.sites.find((s) => s.id === jointB.siteA)!; // coupler's own site at B
  return {
    x: siteA.local[0] + (siteB.local[0] - siteA.local[0]) * 0.3,
    y: siteA.local[1] + (siteB.local[1] - siteA.local[1]) * 0.3 + 8,
  };
}

/** Splits `dragCanvas`'s gesture in half: drags to the midpoint WITHOUT releasing, lets the
 * caller inspect mid-drag state, then finishes the second half and releases. */
async function dragCanvasHalves(
  page: Page,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
  steps: number,
  onMidpoint: () => Promise<void>,
): Promise<void> {
  const stepDelayMs = 16;
  const from = await canvasPoint(page, fromWorld);
  const to = await canvasPoint(page, toWorld);
  const mid = Math.floor(steps / 2);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  for (let i = 1; i <= mid; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.waitForTimeout(stepDelayMs);
  }

  await onMidpoint();

  for (let i = mid + 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.waitForTimeout(stepDelayMs);
  }
  await page.mouse.up();
}

test("Dragging the coupler moves the whole linkage without breaking joints (SC-2)", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);
  await expect.poll(async () => (await getSimInput(page)) !== null).toBe(true);
  // Lets the canvas area's layout (and its `data-viewport`) fully settle after
  // the "Load example" menu action before computing a pixel-precise click
  // target -- the DOM/menu-close transition can still be resizing the canvas
  // area for a short moment right after the click that loads the example.
  await page.waitForTimeout(300);

  const doc = await readSessionDocument(page);
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  const crank = doc.links.find((l) => l.name === "crank")!;
  const rocker = doc.links.find((l) => l.name === "rocker")!;
  const poses0 = await getSimPoses(page);
  const localGrab = couplerLocalGrab(doc, coupler.id);
  const grab = pointOnLink(poses0, doc, coupler.id, localGrab);
  const target = { x: grab.x - 25, y: grab.y + 15 };

  await dragCanvasHalves(page, grab, target, 25, async () => {
    const midPoses = await getSimPoses(page);
    expect(maxJointResidual(doc, midPoses)).toBeLessThan(1e-6);
  });

  const poses1 = await getSimPoses(page);
  expect(maxJointResidual(doc, poses1)).toBeLessThan(1e-6);

  const crankAngle0 = poses0![crank.id]?.angle ?? crank.pose.angle;
  const crankAngle1 = poses1![crank.id].angle;
  expect(Math.abs(crankAngle1 - crankAngle0)).toBeGreaterThan((5 * Math.PI) / 180);

  const rockerAngle0 = poses0![rocker.id]?.angle ?? rocker.pose.angle;
  const rockerAngle1 = poses1![rocker.id].angle;
  expect(Math.abs(rockerAngle1 - rockerAngle0)).toBeGreaterThan(1e-3);

  const grabbedNow = pointOnLink(poses1, doc, coupler.id, localGrab);
  const distStart = Math.hypot(grab.x - target.x, grab.y - target.y);
  const distEnd = Math.hypot(grabbedNow.x - target.x, grabbedNow.y - target.y);
  expect(distEnd).toBeLessThan(distStart * 0.7);

  const inputBefore = await getSimInput(page);
  await page.waitForTimeout(50);

  const slider = page.getByRole("slider", { name: /Entrada/ });
  const sliderValue = Number(await slider.getAttribute("aria-valuenow"));
  expect(Math.abs(sliderValue - (inputBefore?.display ?? 0))).toBeLessThan(0.5);

  await pressSpace(page);
  const docAfter = await readSessionDocument(page);
  expect(docAfter).toEqual(doc);

  expect(pageErrors).toEqual([]);
});

test("Drag at a scrubbed pose hits the SIMULATED geometry (Pitfall 1 guard)", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);

  const slider = page.getByRole("slider", { name: /Entrada/ });
  await slider.focus();
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press("ArrowRight");
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await getSimInput(page))?.display).toBeCloseTo(150, 0);

  const doc = await readSessionDocument(page);
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  const poses = await getSimPoses(page);
  expect(poses).not.toBeNull();
  const localGrab = couplerLocalGrab(doc, coupler.id);
  const grab = pointOnLink(poses, doc, coupler.id, localGrab);
  const referencePoint = pointOnLink(null, doc, coupler.id, localGrab);

  expect(Math.hypot(grab.x - referencePoint.x, grab.y - referencePoint.y)).toBeGreaterThan(15);

  const inputBefore = await getSimInput(page);
  const target = { x: grab.x + 14, y: grab.y + 14 };
  await dragCanvas(page, grab, target, { steps: 15 });

  const inputAfter = await getSimInput(page);
  expect(Math.abs((inputAfter?.display ?? 0) - (inputBefore?.display ?? 0))).toBeGreaterThan(2);

  const posesAfter = await getSimPoses(page);
  expect(maxJointResidual(doc, posesAfter)).toBeLessThan(1e-6);

  expect(pageErrors).toEqual([]);
});

test("No-motor mechanism: drag still drives it via the temporary driver", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  const base = buildFourBarDocument();
  const noMotorDoc: MechanismDocument = { ...base, motors: [] };
  await seedDocument(page, noMotorDoc);
  await page.goto("/");
  await pressSpace(page);
  await expect.poll(async () => (await getSimInput(page)) !== null).toBe(true);

  const doc = await readSessionDocument(page);
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  const crank = doc.links.find((l) => l.name === "crank")!;
  const poses0 = await getSimPoses(page);
  const localGrab = couplerLocalGrab(doc, coupler.id);
  const grab = pointOnLink(poses0, doc, coupler.id, localGrab);
  const target = { x: grab.x - 25, y: grab.y + 15 };

  await dragCanvas(page, grab, target, { steps: 25 });

  const poses1 = await getSimPoses(page);
  expect(maxJointResidual(doc, poses1)).toBeLessThan(1e-6);
  const crankAngle0 = poses0![crank.id]?.angle ?? crank.pose.angle;
  const crankAngle1 = poses1![crank.id].angle;
  expect(Math.abs(crankAngle1 - crankAngle0)).toBeGreaterThan((5 * Math.PI) / 180);

  await expect(page.getByRole("slider")).toBeDisabled();

  expect(pageErrors).toEqual([]);
});

test("Dragging empty space or ground does nothing", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);
  await expect.poll(async () => (await getSimInput(page)) !== null).toBe(true);

  const before: SimPoseMap = await getSimPoses(page);

  // More than 60mm from every link.
  await dragCanvas(page, { x: -80, y: -60 }, { x: -60, y: -40 }, { steps: 5 });
  const afterEmpty: SimPoseMap = await getSimPoses(page);
  expect(afterEmpty).toEqual(before);

  // A point 6mm below the ground pivot O4 (100, 0): well outside the hit
  // radius of O4's site or the rocker's site B, and the ground body itself
  // is never a valid drag target regardless.
  await dragCanvas(page, { x: 100, y: -6 }, { x: 90, y: -20 }, { steps: 5 });
  const afterGround: SimPoseMap = await getSimPoses(page);
  expect(afterGround).toEqual(before);

  expect(pageErrors).toEqual([]);
});
