/**
 * Real-browser proof for UX-02 / SC-5: the empty state offers the five
 * bundled examples, each loads straight into Simulate and moves on Play, the
 * empty state never blocks a tool, and an edited drawing asks before it is
 * replaced.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  clickCanvasPoint,
  getSimInput,
  getSimMode,
  getSimPoses,
  getSimStatus,
  loadExampleFourBar,
  readSessionDocument,
} from "./helpers";

const EXAMPLES: readonly { id: string; links: number }[] = [
  { id: "four-bar", links: 4 },
  { id: "slider-crank", links: 4 },
  { id: "watt", links: 6 },
  { id: "stephenson", links: 6 },
  { id: "eight-bar", links: 8 },
];

/** Both file pickers are removed so File > Open/Save never opens a native dialog. */
async function removeFilePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
}

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  return errors;
}

test("a fresh page shows the empty state with five example cards", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await removeFilePickers(page);
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("example-card")).toHaveCount(5);
  expect(pageErrors).toEqual([]);
});

for (const example of EXAMPLES) {
  test(`example "${example.id}" loads into Simulate and moves on Play`, async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await removeFilePickers(page);
    await page.goto("/");
    await page.locator(`[data-testid="example-card"][data-example-id="${example.id}"]`).click();

    await expect
      .poll(async () => (await readSessionDocument(page).catch(() => null))?.links.length ?? 0)
      .toBe(example.links);
    await expect.poll(() => getSimMode(page)).toBe("simulate");
    await expect.poll(async () => (await getSimStatus(page))?.status).toBe("ready");
    await expect(page.getByTestId("empty-state")).toHaveCount(0);

    const before = JSON.stringify(await getSimPoses(page));
    const inputBefore = (await getSimInput(page))?.input ?? 0;
    await page.getByRole("button", { name: "Reproducir" }).click();
    await expect
      .poll(async () => Math.abs(((await getSimInput(page))?.input ?? 0) - inputBefore), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0.05);
    expect(JSON.stringify(await getSimPoses(page))).not.toBe(before);
    expect(pageErrors).toEqual([]);
  });
}

test("picking a tool hides the empty state and canvas clicks still work", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await removeFilePickers(page);
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.click('[data-tool-id="groundPivot"]');
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  await clickCanvasPoint(page, { x: 0, y: 0 });
  await expect
    .poll(async () => (await readSessionDocument(page).catch(() => null))?.links.length)
    .toBe(1);
  expect(pageErrors).toEqual([]);
});

test("an edited drawing asks before an example replaces it", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await removeFilePickers(page);
  await page.goto("/");
  await loadExampleFourBar(page);

  await page.getByRole("button", { name: "Archivo" }).click();
  await page.getByRole("menuitem", { name: "Ejemplos…" }).click();
  await page.locator('[data-testid="example-card"][data-example-id="watt"]').click();
  await expect(page.getByTestId("replace-confirm")).toBeVisible();
  expect((await readSessionDocument(page)).links).toHaveLength(4);

  await page.getByRole("button", { name: "Cancelar" }).click();
  expect((await readSessionDocument(page)).links).toHaveLength(4);

  await page.locator('[data-testid="example-card"][data-example-id="watt"]').click();
  await page.getByRole("button", { name: "Reemplazar" }).click();
  await expect.poll(async () => (await readSessionDocument(page)).links.length).toBe(6);
  await expect.poll(() => getSimMode(page)).toBe("simulate");
  expect(pageErrors).toEqual([]);
});
