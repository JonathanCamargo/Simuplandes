/**
 * Real-browser E2E for SC-1 (Space toggles Simulate, the scrubber drives
 * the motor, Build restores the exact reference pose) and the first half of
 * SC-3 (the example four-bar's coupler curve closes after one revolution).
 * Every test collects `pageerror` events and asserts there are none.
 */
import { test, expect } from "@playwright/test";
import {
  distance,
  getSimInput,
  getSimMode,
  getSimPlot,
  getSimPoses,
  getSimStatus,
  getSimTrace,
  loadExampleFourBar,
  maxJointResidual,
  pointOnLink,
  pressSpace,
  readSessionDocument,
  seedDocument,
} from "./helpers";
import { createMechanismStore, buildExampleFourBar } from "../src/store";
import { localToWorld } from "../src/geom";
import { poseFromWorldPoints, worldToLinkLocal, type MechanismDocument } from "../src/model";

/** A fresh `buildExampleFourBar` document (built through a scratch, in-memory `MechanismStore` -- never through `src/kinematics`, which the seam forbids outside `src/sim/**`). */
function buildFourBarDocument(): MechanismDocument {
  const store = createMechanismStore();
  buildExampleFourBar(store);
  return store.getState().document;
}

/**
 * `buildExampleFourBar` plus a fifth bar rigidly pinning the crank's site A
 * to the ground's site O4 (via `addLink` + two `addJoint`s, mirroring
 * `buildExampleFourBar`'s own site handling): a truss, 0 DOF, not-drivable.
 */
function buildFourBarTrussDocument(): MechanismDocument {
  const store = createMechanismStore();
  const ids = buildExampleFourBar(store);
  const doc = store.getState().document;
  const jointA = doc.joints.find((j) => j.name === "A")!;
  const jointO4 = doc.joints.find((j) => j.name === "O4")!;
  const crank = doc.links.find((l) => l.id === ids.crankId)!;
  const ground = doc.links.find((l) => l.id === ids.groundId)!;
  const crankSiteA = crank.sites.find((s) => s.id === jointA.siteA)!;
  const groundSiteO4 = ground.sites.find((s) => s.id === jointO4.siteB)!;

  const worldA = localToWorld(
    { x: crankSiteA.local[0], y: crankSiteA.local[1] },
    { x: crank.pose.position[0], y: crank.pose.position[1] },
    crank.pose.angle,
  );
  const worldO4 = localToWorld(
    { x: groundSiteO4.local[0], y: groundSiteO4.local[1] },
    { x: ground.pose.position[0], y: ground.pose.position[1] },
    ground.pose.angle,
  );

  const fifthPose = poseFromWorldPoints(worldA, worldO4);
  const fifth = store.getState().addLink({
    name: "fifth-bar",
    pose: fifthPose,
    sites: [
      { local: worldToLinkLocal(fifthPose, worldA) },
      { local: worldToLinkLocal(fifthPose, worldO4) },
    ],
  });
  store
    .getState()
    .addJoint({ type: "R", siteA: crankSiteA.id, siteB: fifth.siteIds[0], name: "fifth-A" });
  store
    .getState()
    .addJoint({ type: "R", siteA: groundSiteO4.id, siteB: fifth.siteIds[1], name: "fifth-O4" });

  return store.getState().document;
}

function trackPageErrors(page: import("@playwright/test").Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

/**
 * The full visual composite of every visible Konva layer canvas inside
 * `[data-testid=canvas-area]` (Grid, Traces, Links, Joints, Overlays,
 * Rulers -- each its own `<canvas>`, stacked in DOM/paint order), drawn
 * onto one offscreen canvas and read back as a plain pixel array (so it
 * round-trips through `page.evaluate` and compares with `toEqual`).
 *
 * Deviation from the plan's literal `canvasArea.screenshot()` +
 * `Buffer.compare`: a full-element PNG screenshot of `canvasArea` also
 * captures the absolutely-positioned "Fit" HTML button overlaid on top of
 * the canvas, and Playwright's element-screenshot capture path (DOM
 * compositing + PNG encoding) turned out to be genuinely non-deterministic
 * from one capture to the next -- confirmed by a throwaway diagnostic that
 * found ~5% of pixels differing by +-1 per channel between two screenshots
 * of the SAME reference pose, even with the plan's own suggested 100ms
 * settle wait. Compositing the canvases' OWN pixel buffers directly
 * (bypassing screenshot capture/PNG encoding, and the irrelevant HTML
 * overlay, entirely) proved bit-for-bit IDENTICAL across the same
 * before/after toggle, while still being sensitive to a real change (a
 * throwaway diff of entering vs. leaving Simulate, and of a 30-degree
 * scrub, both showed large, real pixel differences) -- a strictly stronger
 * proof that Simulate returns the exact reference pose, without the
 * unrelated overlay/encoding flakiness.
 */
async function readCanvasPixels(page: import("@playwright/test").Page): Promise<number[]> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('[data-testid="canvas-area"]');
    if (!container) throw new Error("[data-testid=canvas-area] not found");
    const canvases = Array.from(container.querySelectorAll("canvas")).filter((c) => {
      const style = getComputedStyle(c);
      return (
        style.display !== "none" && style.visibility !== "hidden" && c.width > 0 && c.height > 0
      );
    });
    if (canvases.length === 0) throw new Error("no visible <canvas> found inside canvas-area");
    const width = Math.max(...canvases.map((c) => c.width));
    const height = Math.max(...canvases.map((c) => c.height));
    const offscreen = document.createElement("canvas");
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext("2d");
    if (!ctx) throw new Error("offscreen canvas has no 2d context");
    for (const c of canvases) ctx.drawImage(c, 0, 0);
    return Array.from(ctx.getImageData(0, 0, width, height).data);
  });
}

test("Space toggles Simulate; scrubber drives the motor; Build restores the exact reference pose", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  const docBefore = await readSessionDocument(page);

  // Park the mouse away from the canvas so no hover highlight pollutes the
  // before/after pixel comparison.
  await page.mouse.move(2, 2);
  const canvasPixelsBefore = await readCanvasPixels(page);

  await pressSpace(page);
  await expect.poll(() => getSimMode(page)).toBe("simulate");
  await expect(page.getByRole("button", { name: "Simular" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const inputAtEntry = await getSimInput(page);
  expect(inputAtEntry?.display).toBeCloseTo(60, 6);

  const slider = page.getByRole("slider", { name: /Entrada/ });
  await slider.focus();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("ArrowRight");
  }

  await expect.poll(async () => (await getSimInput(page))?.display).toBeCloseTo(90, 1);

  const poses = await getSimPoses(page);
  expect(poses).not.toBeNull();
  const crank = docBefore.links.find((l) => l.name === "crank")!;
  const rocker = docBefore.links.find((l) => l.name === "rocker")!;
  const crankPoseAfter = poses![crank.id];
  const rockerPoseAfter = poses![rocker.id];
  expect(crankPoseAfter).toBeTruthy();
  expect(rockerPoseAfter).toBeTruthy();
  const crankDelta = crankPoseAfter.angle - crank.pose.angle;
  expect(Math.abs(crankDelta - (30 * Math.PI) / 180)).toBeLessThan(1e-6);
  expect(Math.abs(rockerPoseAfter.angle - rocker.pose.angle)).toBeGreaterThan(1e-3);

  expect(maxJointResidual(docBefore, poses)).toBeLessThan(1e-6);

  await pressSpace(page);
  await expect.poll(() => getSimMode(page)).toBe("build");
  expect(await getSimPoses(page)).toBeNull();
  const docAfter = await readSessionDocument(page);
  expect(docAfter).toEqual(docBefore);

  await page.waitForTimeout(100);
  const canvasPixelsAfter = await readCanvasPixels(page);
  expect(canvasPixelsAfter).toEqual(canvasPixelsBefore);

  expect(pageErrors).toEqual([]);
});

test("Play animates and Pause stops", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  const doc = await readSessionDocument(page);

  await pressSpace(page);
  await page.getByRole("button", { name: "Reproducir" }).click();
  await page.waitForTimeout(500);

  const input = await getSimInput(page);
  expect(input?.input ?? 0).toBeGreaterThan(0.2);

  await page.getByRole("button", { name: "Pausar" }).click();
  const inputAtPause = (await getSimInput(page))?.input ?? 0;
  await page.waitForTimeout(300);
  const inputAfterWait = (await getSimInput(page))?.input ?? 0;
  expect(inputAfterWait).toBeCloseTo(inputAtPause, 6);

  const poses = await getSimPoses(page);
  expect(maxJointResidual(doc, poses)).toBeLessThan(1e-6);

  expect(pageErrors).toEqual([]);
});

test("the coupler curve closes after a full revolution", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  const doc = await readSessionDocument(page);
  const marker = doc.markers[0];

  await pressSpace(page);
  await expect.poll(() => getSimMode(page)).toBe("simulate");

  const trace = await getSimTrace(page, marker.id);
  expect(trace).not.toBeNull();
  expect(trace!.closed).toBe(true);
  expect(trace!.points.length).toBeGreaterThanOrEqual(360);

  const first = trace!.points[0];
  const last = trace!.points[trace!.points.length - 1];
  expect(distance({ x: first[0], y: first[1] }, { x: last[0], y: last[1] })).toBeLessThan(1e-6);

  // A full-rotation sweep starts at input 0 (the document's own reference
  // pose) -- the trace's first point must equal the marker's reference
  // world position, computed independently from the document alone.
  const referenceWorld = pointOnLink(null, doc, marker.linkId, {
    x: marker.local[0],
    y: marker.local[1],
  });
  expect(distance({ x: first[0], y: first[1] }, referenceWorld)).toBeLessThan(1e-6);

  const xs = trace!.points.map((p) => p[0]);
  const ys = trace!.points.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);

  expect(pageErrors).toEqual([]);
});

test("temporary driver: no motor still simulates by drag; the scrubber is disabled", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  const base = buildFourBarDocument();
  const noMotorDoc: MechanismDocument = { ...base, motors: [] };
  await seedDocument(page, noMotorDoc);
  await page.goto("/");

  await pressSpace(page);
  await expect.poll(() => getSimMode(page)).toBe("simulate");

  await expect(page.getByRole("slider")).toBeDisabled();
  await expect(
    page.getByText("agrega un motor para usar el deslizador", { exact: false }),
  ).toBeVisible();
  const status = await getSimStatus(page);
  expect(status?.drivingMode).toBe("temporary");

  expect(pageErrors).toEqual([]);
});

test("a non-drivable truss does not crash", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  const trussDoc = buildFourBarTrussDocument();
  await seedDocument(page, trussDoc);
  await page.goto("/");

  await pressSpace(page);
  await expect.poll(() => getSimMode(page)).toBe("simulate");

  await expect(page.getByText("no puede moverse", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reproducir" })).toBeDisabled();

  // Confirms the plots chip and the rest of the sim UI are inert but alive.
  const plot = await getSimPlot(page);
  expect(plot).toBeTruthy();

  expect(pageErrors).toEqual([]);
});
