/**
 * SC-1 (real browser): a positioned GraphThe JSON is dropped / opened, the
 * import dialog previews it (Drawing + Graph) with no warnings and a ready
 * verdict, Import draws it, and Play moves it. Also: File > Open of a graph
 * file routes to the import dialog.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  disableNativeFilePickers,
  dropGraphText,
  getSimMode,
  getSimPoses,
  getSimStatus,
  readFixtureText,
  readSessionDocument,
} from "./helpers";

async function expectImportPlaysAndMoves(page: Page, links: number): Promise<void> {
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await readSessionDocument(page).catch(() => null))?.links.length ?? 0)
    .toBe(links);
  await expect.poll(() => getSimMode(page)).toBe("simulate");
  await expect.poll(async () => (await getSimStatus(page))?.status).toBe("ready");

  const before = JSON.stringify(await getSimPoses(page));
  await page.getByRole("button", { name: "Reproducir" }).click();
  await expect
    .poll(async () => JSON.stringify(await getSimPoses(page)), { timeout: 5_000 })
    .not.toBe(before);
  expect((await getSimStatus(page))?.status).toBe("ready");
}

test("dropping watt-i.graphthe.json previews it, imports it and Play moves it", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (e) => pageErrors.push(e));
  await disableNativeFilePickers(page);
  await page.goto("/");

  await dropGraphText(page, readFixtureText("watt-i.graphthe.json"), "watt-i.graphthe.json", () =>
    expect(page.getByTestId("drop-overlay")).toBeVisible(),
  );

  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
  const verdict = page.getByTestId("import-verdict");
  await expect(verdict).toHaveAttribute("data-status", "ready");
  await expect(
    page.locator('[data-testid="import-report-item"][data-severity="warning"]'),
  ).toHaveCount(0);

  // Drawing tab: link shapes.
  await expect(page.getByTestId("import-preview-drawing")).toBeVisible();
  await expect(
    page.getByTestId("import-preview-drawing").locator('[data-kind="bar"], [data-kind="plate"]'),
  ).not.toHaveCount(0);
  // Graph tab: 6 nodes.
  await page.getByTestId("import-tab-graph").click();
  await expect(page.getByTestId("import-preview-graph").getByTestId("graph-node")).toHaveCount(6);

  await expectImportPlaysAndMoves(page, 6);
  expect(pageErrors).toEqual([]);
});

test("File > Importar grafo > Abrir archivo imports slider-crank.graphthe.json and it moves", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (e) => pageErrors.push(e));
  await disableNativeFilePickers(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Archivo" }).click();
  await page.getByRole("menuitem", { name: "Importar grafo…" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("import-open-file").click();
  await (
    await chooser
  ).setFiles({
    name: "slider-crank.graphthe.json",
    mimeType: "application/json",
    buffer: Buffer.from(readFixtureText("slider-crank.graphthe.json")),
  });

  await expect(page.getByTestId("import-verdict")).toHaveAttribute("data-status", "ready");
  await expectImportPlaysAndMoves(page, 4);
  expect(pageErrors).toEqual([]);
});

test("File > Abrir with a .graphthe.json routes to the import dialog", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (e) => pageErrors.push(e));
  await disableNativeFilePickers(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Archivo" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Abrir", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "fourbar-crank-rocker.graphthe.json",
    mimeType: "application/json",
    buffer: Buffer.from(readFixtureText("fourbar-crank-rocker.graphthe.json")),
  });

  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await expect(page.getByTestId("import-verdict")).toHaveAttribute("data-status", "ready");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
