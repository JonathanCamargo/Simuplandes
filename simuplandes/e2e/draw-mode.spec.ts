/**
 * Draw mode: the Build | Draw | Simulate toggle swaps the rail to Draw's
 * tools, and Edit shape reshapes a plate's outline by dragging its handles,
 * one undo step per drag.
 */
import { test, expect, type Page } from "@playwright/test";
import { clickCanvasPoint, distance, dragCanvas, readSessionDocument } from "./helpers";

type Vec2 = { x: number; y: number };

async function plateWorldOutline(page: Page): Promise<Vec2[]> {
  const doc = await readSessionDocument(page);
  const plate = doc.links.find((l) => l.shape.kind === "plate");
  if (!plate || plate.shape.kind !== "plate") throw new Error("no plate in the document");
  const [px, py] = plate.pose.position;
  const c = Math.cos(plate.pose.angle);
  const s = Math.sin(plate.pose.angle);
  return plate.shape.outline.map(([x, y]) => ({ x: px + x * c - y * s, y: py + x * s + y * c }));
}

test("Draw mode edits a plate's outline by dragging its vertex and midpoint handles", async ({
  page,
}) => {
  await page.goto("/");

  await page.click('[data-tool-id="plate"]');
  for (const p of [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 },
  ]) {
    await clickCanvasPoint(page, p);
  }
  await page.keyboard.press("Enter");
  const original = await plateWorldOutline(page);
  expect(original).toHaveLength(4);

  // The Draw toggle swaps the rail to Pan, Edit shape, Brush and Eraser, with Edit shape active.
  await page.getByRole("button", { name: "Dibujar" }).click();
  await expect(page.locator("[data-tool-id]")).toHaveCount(4);
  await expect(page.locator('[data-tool-id="vertex"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-tool-id="bar"]')).toHaveCount(0);

  // Pick the plate, then drag its (100, 80) vertex to (130, 110).
  await clickCanvasPoint(page, { x: 50, y: 40 });
  await dragCanvas(page, { x: 100, y: 80 }, { x: 130, y: 110 });
  const moved = await plateWorldOutline(page);
  expect(moved).toHaveLength(4);
  expect(moved.some((v) => distance(v, { x: 130, y: 110 }) < 1)).toBe(true);
  expect(moved.some((v) => distance(v, { x: 100, y: 80 }) < 1)).toBe(false);

  // Dragging the bottom edge's midpoint inserts a fifth vertex.
  await dragCanvas(page, { x: 50, y: 0 }, { x: 50, y: -30 });
  const inserted = await plateWorldOutline(page);
  expect(inserted).toHaveLength(5);
  expect(inserted.some((v) => distance(v, { x: 50, y: -30 }) < 1)).toBe(true);

  // Each drag is one undo step.
  await page.keyboard.press("Control+z");
  expect(await plateWorldOutline(page)).toHaveLength(4);
  await page.keyboard.press("Control+z");
  const restored = await plateWorldOutline(page);
  for (const [i, v] of restored.entries()) expect(distance(v, original[i])).toBeLessThan(1e-6);

  // Back in Build, the full rail returns.
  await page.getByRole("button", { name: "Construir" }).click();
  await expect(page.locator('[data-tool-id="bar"]')).toHaveCount(1);
});

test("Draw mode bends a bar into an arc and the edge toolbar turns it into a curve", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 0, y: 0 });
  await clickCanvasPoint(page, { x: 100, y: 0 });
  await page.keyboard.press("Escape");
  const before = await readSessionDocument(page);
  const bar = before.links.find((l) => l.shape.kind === "bar" && !l.isGround)!;

  await page.getByRole("button", { name: "Dibujar" }).click();
  await clickCanvasPoint(page, { x: 30, y: 0 }); // pick the bar
  await dragCanvas(page, { x: 50, y: 0 }, { x: 50, y: 20 });

  const bent = (await readSessionDocument(page)).links.find((l) => l.id === bar.id)!;
  if (bent.shape.kind !== "bar") throw new Error("not a bar");
  expect(bent.shape.edges).toHaveLength(1);
  const arc = bent.shape.edges![0];
  expect(arc.kind).toBe("arc");
  if (arc.kind === "arc") expect(arc.bulge).toBeCloseTo(0.4, 1);
  expect(bent.sites).toEqual(bar.sites);

  // A click on the arc's apex selects the edge and shows the toolbar.
  await clickCanvasPoint(page, { x: 50, y: 20 });
  const toolbar = page.getByTestId("edge-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Dividir" })).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Curva" }).click();
  const curved = (await readSessionDocument(page)).links.find((l) => l.id === bar.id)!;
  expect(curved.shape.edges?.[0].kind).toBe("bezier");

  const shot = testInfo.outputPath("draw-curved-bar.png");
  await page.screenshot({ path: shot });
  testInfo.annotations.push({ type: "screenshot", description: shot });

  await toolbar.getByRole("button", { name: "Recta" }).click();
  const straight = (await readSessionDocument(page)).links.find((l) => l.id === bar.id)!;
  expect(straight.shape.edges).toBeUndefined();
});
