/**
 * Shared E2E helpers: converting a world-space point into a page-space
 * click point (via the real viewport transform, never a hardcoded pixel
 * guess), reading the autosaved document back out of `localStorage`,
 * resolving a site's world position for assembled-joint assertions, and
 * (Phase 5) the Simulate-mode test-hook readers, canvas-drag, and
 * seed-document helpers shared by plans 05-06/05-07/05-08.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { cross, localToWorld, normalize, rotate, sub, type Vec2 } from "../src/geom";
import { worldToScreen, type Viewport } from "../src/canvas/viewport";
import type { MechanismDocument } from "../src/model";
import type { SimTestHook, SimTestHookPose } from "../src/sim/react/testHook";

export const SESSION_STORAGE_KEY = "simuplandes:session";

/**
 * Reads `[data-testid=canvas-area]`'s `data-viewport` JSON and the real
 * Konva `<canvas>` element's bounding box, then returns the PAGE point
 * (canvas box origin + `worldToScreen(viewport, world)`) to click/hover at.
 */
export async function canvasPoint(page: Page, world: Vec2): Promise<Vec2> {
  const canvasArea = page.locator('[data-testid="canvas-area"]');
  const viewportJson = await canvasArea.getAttribute("data-viewport");
  if (!viewportJson) throw new Error("canvas-area has no data-viewport attribute");
  const viewport = JSON.parse(viewportJson) as Viewport;

  const canvasBox = await canvasArea.locator("canvas").first().boundingBox();
  if (!canvasBox) throw new Error("the Konva <canvas> element has no bounding box");

  const screen = worldToScreen(viewport, world);
  return { x: canvasBox.x + screen.x, y: canvasBox.y + screen.y };
}

/**
 * Clicks a world-space point on the canvas. Uses `{ delay: 30 }` between
 * mousedown/mouseup: Konva's `Stage.getPointerPosition()` needs the browser
 * to have actually dispatched (and Konva to have processed) a pointer
 * position update before mouseup fires, which a zero-delay `mouse.click()`
 * can otherwise race -- confirmed by a debug probe where undelayed clicks
 * silently produced no effect (no error, no created entity) while the same
 * click with a delay worked every time.
 */
export async function clickCanvasPoint(page: Page, world: Vec2): Promise<void> {
  const point = await canvasPoint(page, world);
  await page.mouse.click(point.x, point.y, { delay: 30 });
}

/**
 * Dispatches `pagehide` (flushing the debounced autosave synchronously,
 * per `persistence/session.ts`) then reads and parses `simuplandes:session`
 * from `localStorage`. Throws if the key is empty (nothing autosaved yet).
 */
export async function readSessionDocument(page: Page): Promise<MechanismDocument> {
  const raw = await page.evaluate((key) => {
    window.dispatchEvent(new Event("pagehide"));
    return window.localStorage.getItem(key);
  }, SESSION_STORAGE_KEY);
  if (raw === null) throw new Error(`localStorage["${SESSION_STORAGE_KEY}"] is empty`);
  return JSON.parse(raw) as MechanismDocument;
}

/** The world position of a site, resolved through its owning link's pose. */
export function siteWorld(doc: MechanismDocument, siteId: string): Vec2 {
  for (const link of doc.links) {
    const site = link.sites.find((s) => s.id === siteId);
    if (site) {
      const origin: Vec2 = { x: link.pose.position[0], y: link.pose.position[1] };
      const local: Vec2 = { x: site.local[0], y: site.local[1] };
      return localToWorld(local, origin, link.pose.angle);
    }
  }
  throw new Error(`site not found in document: ${siteId}`);
}

/** Euclidean distance between two points, for exact-length assertions. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// --- Phase 5 (Simulate mode) helpers ------------------------------------

/**
 * A `page.evaluate` wrapper around the DEV-only `window.__simuplandesSim`
 * test hook (`src/sim/react/testHook.ts`): throws a clear error if the hook
 * is missing (e.g. a production build), rather than a generic "undefined is
 * not a function". `fn` must not close over any outer (Node-side) variable
 * -- it is stringified and reconstructed inside the page, exactly like any
 * other `page.evaluate` callback.
 */
export async function simHook<T>(page: Page, fn: (hook: SimTestHook) => T): Promise<T> {
  return page.evaluate((fnSource: string) => {
    const hook = window.__simuplandesSim;
    if (!hook) {
      throw new Error(
        "window.__simuplandesSim is not installed -- the DEV-only Simulate test hook is missing (is this a production build?)",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- reconstructing a caller-supplied, closure-free function inside the page (the standard Playwright pattern for a generic `page.evaluate` wrapper), then casting it to the exact signature `fn` was passed in as.
    const reconstructed = new Function(`return (${fnSource});`)() as (h: SimTestHook) => T;
    return reconstructed(hook);
  }, fn.toString());
}

export function getSimMode(page: Page): Promise<ReturnType<SimTestHook["getMode"]>> {
  return simHook(page, (h) => h.getMode());
}

export function getSimPoses(page: Page): Promise<ReturnType<SimTestHook["getPoses"]>> {
  return simHook(page, (h) => h.getPoses());
}

export function getSimInput(page: Page): Promise<ReturnType<SimTestHook["getInput"]>> {
  return simHook(page, (h) => h.getInput());
}

export function getSimStatus(page: Page): Promise<ReturnType<SimTestHook["getStatus"]>> {
  return simHook(page, (h) => h.getStatus());
}

export function getSimReadout(page: Page): Promise<ReturnType<SimTestHook["getReadout"]>> {
  return simHook(page, (h) => h.getReadout());
}

export function getSimPlot(page: Page): Promise<ReturnType<SimTestHook["getPlot"]>> {
  return simHook(page, (h) => h.getPlot());
}

/** `getTrace` needs an extra (markerId) argument, which a `page.evaluate` callback can only receive via its own second `arg` parameter -- not via closing over an outer variable -- so it bypasses `simHook`. */
export function getSimTrace(
  page: Page,
  markerId: string,
): Promise<ReturnType<SimTestHook["getTrace"]>> {
  return page.evaluate((id: string) => {
    const hook = window.__simuplandesSim;
    if (!hook) {
      throw new Error(
        "window.__simuplandesSim is not installed -- the DEV-only Simulate test hook is missing (is this a production build?)",
      );
    }
    return hook.getTrace(id);
  }, markerId);
}

/**
 * Opens the File menu and loads the four-bar example, then waits until
 * `readSessionDocument` reports 4 links (the autosave has caught up).
 */
export async function loadExampleFourBar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Archivo" }).click();
  await page.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" }).click();
  await expect.poll(async () => (await readSessionDocument(page)).links.length).toBe(4);
}

/**
 * Seeds `localStorage[SESSION_STORAGE_KEY]` with `doc` via `addInitScript`
 * -- runs BEFORE any page script, so the app's own real restore path
 * (`persistence/session.ts`) loads it on `page.goto("/")`, exactly like a
 * real returning user. Must be called before `page.goto`.
 */
export async function seedDocument(page: Page, doc: MechanismDocument): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: SESSION_STORAGE_KEY, value: JSON.stringify(doc) },
  );
}

/**
 * Drags from one world point to another: mouse down, a short pause (Konva
 * needs a real pointer-position update processed before the drag starts --
 * see `clickCanvasPoint`'s own TSDoc), then `steps` interpolated
 * `mouse.move` calls each followed by a `stepDelayMs` pause, then mouse up.
 */
export async function dragCanvas(
  page: Page,
  fromWorld: Vec2,
  toWorld: Vec2,
  options?: { steps?: number; stepDelayMs?: number },
): Promise<void> {
  const steps = options?.steps ?? 20;
  const stepDelayMs = options?.stepDelayMs ?? 16;
  const from = await canvasPoint(page, fromWorld);
  const to = await canvasPoint(page, toWorld);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.waitForTimeout(stepDelayMs);
  }
  await page.mouse.up();
}

/** A `getSimPoses()` result: `null` means "render the reference pose" (see `PosesSource`'s own contract). */
export type SimPoseMap = Record<string, SimTestHookPose> | null;

function posedLinkFrame(
  doc: MechanismDocument,
  poses: SimPoseMap,
  linkId: string,
): { origin: Vec2; angle: number } {
  const posed = poses?.[linkId];
  if (posed) return { origin: { x: posed.position[0], y: posed.position[1] }, angle: posed.angle };
  const link = doc.links.find((l) => l.id === linkId);
  if (!link) throw new Error(`link not found in document: ${linkId}`);
  return { origin: { x: link.pose.position[0], y: link.pose.position[1] }, angle: link.pose.angle };
}

function owningLinkId(doc: MechanismDocument, siteId: string): string {
  for (const link of doc.links) {
    if (link.sites.some((s) => s.id === siteId)) return link.id;
  }
  throw new Error(`site not found in document: ${siteId}`);
}

/** A site's world position under `poses` (falling back to `link.pose` for any link absent from the map -- e.g. `poses === null`, or a link the sim never moved). */
export function posedSiteWorld(doc: MechanismDocument, poses: SimPoseMap, siteId: string): Vec2 {
  const linkId = owningLinkId(doc, siteId);
  const link = doc.links.find((l) => l.id === linkId)!;
  const site = link.sites.find((s) => s.id === siteId)!;
  const frame = posedLinkFrame(doc, poses, linkId);
  return localToWorld({ x: site.local[0], y: site.local[1] }, frame.origin, frame.angle);
}

/** The world position of a link-local point under `poses` (same fallback rule as `posedSiteWorld`). */
export function pointOnLink(
  poses: SimPoseMap,
  doc: MechanismDocument,
  linkId: string,
  local: Vec2,
): Vec2 {
  const frame = posedLinkFrame(doc, poses, linkId);
  return localToWorld(local, frame.origin, frame.angle);
}

/**
 * The worst joint violation under `poses`: for every R joint, the distance
 * between its two sites' posed world positions; for every P joint, the
 * perpendicular offset of siteB from siteA's slide axis (defined in
 * siteA's link-local frame, rotated into world by siteA's link's posed
 * angle). Falls back to `link.pose` for any link `poses` doesn't cover.
 */
export function maxJointResidual(doc: MechanismDocument, poses: SimPoseMap): number {
  let max = 0;
  for (const joint of doc.joints) {
    const a = posedSiteWorld(doc, poses, joint.siteA);
    const b = posedSiteWorld(doc, poses, joint.siteB);
    if (joint.type === "R") {
      max = Math.max(max, distance(a, b));
    } else {
      const linkAId = owningLinkId(doc, joint.siteA);
      const frameA = posedLinkFrame(doc, poses, linkAId);
      const axisWorld = rotate({ x: joint.axis[0], y: joint.axis[1] }, frameA.angle);
      const axisUnit = normalize(axisWorld);
      const perp = Math.abs(cross(axisUnit, sub(b, a)));
      max = Math.max(max, perp);
    }
  }
  return max;
}

/**
 * Blurs any focused form control (so Space doesn't just re-activate a
 * focused button natively) then presses Space -- the Build<->Simulate
 * toggle shortcut.
 */
export async function pressSpace(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
}

// --- Phase 9 (graph import) helpers --------------------------------------

/**
 * Forces the `browser-fs-access` input-element fallback (so a real
 * `filechooser` event fires) by deleting both native pickers. Must be called
 * before `page.goto`.
 */
export async function disableNativeFilePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
}

/**
 * Simulates dropping a text file on the page: dragenter + dragover (so the
 * drop overlay appears), then `beforeDrop` (assert the overlay here), then
 * drop -- all dispatched on `body` with one shared `DataTransfer`.
 */
export async function dropGraphText(
  page: Page,
  text: string,
  fileName: string,
  beforeDrop?: () => Promise<void>,
): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ({ content, name }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: "application/json" }));
      return dt;
    },
    { content: text, name: fileName },
  );
  const fire = (type: string): Promise<void> =>
    page.evaluate(
      ({ dt, eventType }) => {
        document.body.dispatchEvent(
          new DragEvent(eventType, { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      },
      { dt: dataTransfer, eventType: type },
    );
  await fire("dragenter");
  await fire("dragover");
  if (beforeDrop) await beforeDrop();
  await fire("drop");
}

/** Reads a checked-in `fixtures/<name>` file (the E2E cwd is the app root). */
export function readFixtureText(name: string): string {
  return fs.readFileSync(path.resolve("fixtures", name), "utf8");
}

/** File > "Importar grafo..." then fills the paste box (Spanish UI). */
export async function pasteImportText(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "Archivo" }).click();
  await page.getByRole("menuitem", { name: "Importar grafo…" }).click();
  await page.getByTestId("import-paste").fill(text);
}
