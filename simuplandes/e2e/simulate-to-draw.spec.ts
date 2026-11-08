/**
 * Simulate -> Draw holds the simulated frame: after DRAGGING the mechanism
 * (which re-renders the canvas mid-drag), the joints must stay on the links
 * in Draw, not snap back to the Build pose. Build then restores both.
 * Reads Konva node positions directly: pins are positioned by x/y, links by points.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  dragCanvas,
  getSimMode,
  getSimPoses,
  loadExampleFourBar,
  pointOnLink,
  readSessionDocument,
} from "./helpers";

interface CanvasSnapshot {
  pins: [number, number][];
  linkEnds: [number, number][];
}

/** Every pin's screen position and every link outline's first and last vertex. */
function snapshot(page: Page): Promise<CanvasSnapshot> {
  return page.evaluate(() => {
    interface KNode {
      id(): string;
      x(): number;
      y(): number;
      getChildren(): { points(): number[] }[];
    }
    const konva = (
      window as unknown as { Konva: { stages: { find(f: (n: KNode) => boolean): KNode[] }[] } }
    ).Konva;
    const stage = konva.stages[0];
    const pins = stage
      .find((n) => n.id().startsWith("pin:"))
      .map((n) => [n.x(), n.y()] as [number, number]);
    const linkEnds: [number, number][] = [];
    for (const n of stage.find((node) => node.id().startsWith("link:"))) {
      const p = n.getChildren()[0].points();
      linkEnds.push([p[0], p[1]], [p[p.length - 2], p[p.length - 1]]);
    }
    return { pins, linkEnds };
  });
}

/** Every pin sits on some link end (within 1.5 px). */
function pinsOnLinks(s: CanvasSnapshot): boolean {
  return s.pins.every(([px, py]) =>
    s.linkEnds.some(([lx, ly]) => Math.hypot(px - lx, py - ly) < 1.5),
  );
}

test("dragging in Simulate then switching to Draw keeps the joints on the dragged links", async ({
  page,
}) => {
  await page.goto("/");
  await loadExampleFourBar(page);
  await page.getByRole("button", { name: "Simular" }).click();
  await expect.poll(() => getSimMode(page)).toBe("simulate");
  await page.waitForTimeout(300);

  const doc = await readSessionDocument(page);
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  const [a, b] = coupler.sites;
  const mid = { x: (a.local[0] + b.local[0]) / 2, y: (a.local[1] + b.local[1]) / 2 };
  const grab = pointOnLink(await getSimPoses(page), doc, coupler.id, mid);
  const before = await snapshot(page);
  await dragCanvas(page, grab, { x: grab.x - 30, y: grab.y + 10 });

  const dragged = await snapshot(page);
  expect(pinsOnLinks(dragged)).toBe(true);
  expect(dragged.pins).not.toEqual(before.pins);

  await page.getByRole("button", { name: "Dibujar" }).click();
  await expect.poll(() => getSimMode(page)).toBe("draw");
  await expect.poll(async () => (await snapshot(page)).pins).toEqual(dragged.pins);
  expect(pinsOnLinks(await snapshot(page))).toBe(true);

  await page.getByRole("button", { name: "Construir" }).click();
  await expect.poll(async () => (await snapshot(page)).pins).toEqual(before.pins);
  expect(pinsOnLinks(await snapshot(page))).toBe(true);
});
