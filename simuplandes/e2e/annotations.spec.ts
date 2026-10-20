/**
 * Draw mode annotations: the Brush paints freehand strokes over the
 * mechanism (color/width from the brush palette), they stay put in
 * Simulate, and the Eraser removes them -- one undo step per stroke/drag.
 */
import { test, expect } from "@playwright/test";
import { dragCanvas, loadExampleFourBar, pressSpace, readSessionDocument } from "./helpers";

test("the Brush paints notes that survive Simulate, and the Eraser removes them", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await loadExampleFourBar(page);

  await page.getByRole("button", { name: "Dibujar" }).click();
  await page.click('[data-tool-id="brush"]');
  const palette = page.getByTestId("brush-toolbar");
  await expect(palette).toBeVisible();
  await palette.getByRole("button", { name: "Rojo" }).click();
  await palette.getByRole("button", { name: "8 px" }).click();

  await dragCanvas(page, { x: -20, y: 70 }, { x: 60, y: 90 }, { steps: 12 });
  await dragCanvas(page, { x: 80, y: 70 }, { x: 120, y: 40 }, { steps: 12 });

  // The session autosave is debounced: wait for both strokes to land.
  await expect.poll(async () => (await readSessionDocument(page)).annotations.length).toBe(2);
  const drawn = await readSessionDocument(page);
  expect(drawn.annotations[0]).toMatchObject({ kind: "stroke", color: "red" });
  expect(drawn.annotations[0].points.length).toBeGreaterThanOrEqual(2);
  expect(drawn.links).toHaveLength(4);

  // Strokes stay where they were drawn while the mechanism simulates.
  await pressSpace(page);
  await expect(page.getByRole("button", { name: "Simular" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({ path: testInfo.outputPath("annotations-simulate.png") });
  expect((await readSessionDocument(page)).annotations).toEqual(drawn.annotations);
  await pressSpace(page);
  await expect(page.locator('[data-tool-id="brush"]')).toHaveCount(1);

  // The Eraser: one drag across the first stroke removes it, one undo brings it back.
  await page.click('[data-tool-id="eraser"]');
  await expect(palette).toHaveCount(0);
  await dragCanvas(page, { x: 20, y: 110 }, { x: 20, y: 50 }, { steps: 8 });
  await expect.poll(async () => (await readSessionDocument(page)).annotations.length).toBe(1);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await readSessionDocument(page)).annotations.length).toBe(2);

  // "Clear all notes": the Eraser's toolbar button, then the palette command.
  const eraserBar = page.getByTestId("eraser-toolbar");
  await eraserBar.getByRole("button", { name: "Borrar todas las notas" }).click();
  await expect.poll(async () => (await readSessionDocument(page)).annotations.length).toBe(0);
  await expect(eraserBar.getByRole("button", { name: "Borrar todas las notas" })).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await readSessionDocument(page)).annotations.length).toBe(2);

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  // The search box takes focus a frame after the dialog appears.
  await expect(page.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("Borrar todas las notas");
  await expect(page.getByRole("option").first()).toHaveText(/Borrar todas las notas/);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await readSessionDocument(page)).annotations.length).toBe(0);
  expect((await readSessionDocument(page)).links).toHaveLength(4);
});
