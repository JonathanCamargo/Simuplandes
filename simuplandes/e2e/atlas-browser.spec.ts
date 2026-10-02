/**
 * Real-browser proof for SC-4 / XCH-08: the atlas browser shows a thumbnail
 * for every topology, filters by link count and class, and one click lays a
 * topology out, loads it into Simulate where it identifies as that atlas id
 * in the Graph tab and moves on Play.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  disableNativeFilePickers,
  getSimInput,
  getSimMode,
  getSimPoses,
  getSimStatus,
  readSessionDocument,
} from "./helpers";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  return errors;
}

async function openAtlasFromEmptyState(page: Page): Promise<void> {
  await disableNativeFilePickers(page);
  await page.goto("/");
  await page.getByTestId("empty-state-atlas").click();
  await expect(page.getByTestId("atlas-dialog")).toBeVisible();
}

test("the atlas shows 19 thumbnails and filters by link count and class", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await openAtlasFromEmptyState(page);

  await expect(page.getByTestId("atlas-card")).toHaveCount(19);
  await expect(page.getByTestId("atlas-card").getByTestId("atlas-thumbnail")).toHaveCount(19);

  await page.getByTestId("atlas-size-8").click();
  await expect(page.getByTestId("atlas-card")).toHaveCount(16);
  await page.getByTestId("atlas-size-all").click();

  await page.getByRole("combobox", { name: "Clase" }).click();
  await page.getByTestId("atlas-class-watt").click();
  await expect(page.getByTestId("atlas-card")).toHaveCount(1);
  await expect(page.getByTestId("atlas-card")).toHaveAttribute("data-atlas-id", "T6B_W");
  expect(pageErrors).toEqual([]);
});

const OPEN_CASES: readonly { id: string; links: number }[] = [
  { id: "T15", links: 8 },
  { id: "T6B_S", links: 6 },
];

for (const { id, links } of OPEN_CASES) {
  test(`opening ${id} identifies as ${id} and moves`, async ({ page }) => {
    test.setTimeout(90_000);
    const pageErrors = trackPageErrors(page);
    await openAtlasFromEmptyState(page);

    await page.locator(`[data-testid="atlas-card"][data-atlas-id="${id}"]`).click();
    await expect(page.getByTestId("atlas-dialog")).toHaveCount(0, { timeout: 45_000 });

    await expect
      .poll(async () => (await readSessionDocument(page).catch(() => null))?.links.length ?? 0)
      .toBe(links);
    await expect.poll(() => getSimMode(page)).toBe("simulate");
    await expect.poll(async () => (await getSimStatus(page))?.status).toBe("ready");

    await page.getByRole("tab", { name: "Grafo" }).click();
    await expect(page.getByTestId("graph-check-topology")).toHaveAttribute("data-topology-id", id);

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

test("File > Explorar atlas opens the browser", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await disableNativeFilePickers(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Archivo" }).click();
  await page.getByRole("menuitem", { name: "Explorar atlas…" }).click();
  await expect(page.getByTestId("atlas-dialog")).toBeVisible();
  await expect(page.getByTestId("atlas-card")).toHaveCount(19);
  expect(pageErrors).toEqual([]);
});
