/**
 * Manual-review artifacts for Phase 9's human check (09-VALIDATION's two
 * manual-only rows: auto-layout aesthetics, atlas/gallery legibility):
 * empty state + gallery, examples dialog, atlas dialog (all / 8-bar, both
 * themes), the import dialog for a topology-only T04 drop (Drawing + Graph
 * tabs) and the canvas after opening T08, T14 and T16 from the atlas.
 * Saved under test-results/import-screenshots; asserts no `pageerror`s.
 *
 * Atlas topologies are read from `src/graph/atlas/eightbar.json` via `fs`
 * (`atlasData.ts` uses `import.meta.glob`, which Node-side Playwright cannot load).
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  disableNativeFilePickers,
  dropGraphText,
  getSimStatus,
  pressSpace,
  readSessionDocument,
} from "./helpers";

test.use({ viewport: { width: 1280, height: 800 } });

const OUT_DIR = path.resolve("test-results/import-screenshots");

interface AtlasFile {
  topologies: { id: string; edges: [number, number][] }[];
}
const atlas = JSON.parse(fs.readFileSync("src/graph/atlas/eightbar.json", "utf8")) as AtlasFile;

function topologyText(id: string): string {
  const entry = atlas.topologies.find((t) => t.id === id);
  if (!entry) throw new Error(`atlas topology not found: ${id}`);
  return JSON.stringify({
    nodes: Array.from({ length: 8 }, (_, nodeId) => ({ id: nodeId })),
    edges: entry.edges.map(([source, target]) => ({ source, target })),
  });
}

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

const saved: string[] = [];

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Let MUI dialog/menu enter and exit transitions settle (otherwise two
  // dialogs are captured cross-fading).
  await page.waitForTimeout(800);
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  expect(fs.statSync(filePath).size).toBeGreaterThan(0);
  saved.push(filePath);
}

test.afterAll(() => {
  for (const p of saved) console.log(`screenshot: ${p}`);
});

test("empty state, examples dialog and atlas dialog screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  await disableNativeFilePickers(page);
  await page.goto("/");

  // (a) empty state with the gallery, light, es.
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("example-card")).toHaveCount(5);
  await shot(page, "empty-state-light-es");

  // (c) atlas dialog, light, es: all entries.
  await page.getByTestId("empty-state-atlas").click();
  await expect(page.getByTestId("atlas-card")).toHaveCount(19);
  await shot(page, "atlas-all-light-es");
  await page.getByTestId("atlas-close").click();

  // (b) examples dialog, dark, en.
  await page.click('button[aria-label="Oscuro"]');
  await page.click('button:has-text("EN")');
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Examples/ }).click();
  await expect(page.getByTestId("example-card").first()).toBeVisible();
  await shot(page, "examples-dialog-dark-en");
  await page.keyboard.press("Escape");

  // (c) atlas dialog filtered to 8 links, dark, en.
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Browse atlas|Explore atlas/ }).click();
  await expect(page.getByTestId("atlas-dialog")).toBeVisible();
  await page.getByTestId("atlas-size-8").click();
  await expect(page.getByTestId("atlas-card")).toHaveCount(16);
  await shot(page, "atlas-8bar-dark-en");

  expect(pageErrors).toEqual([]);
});

test("import dialog for a topology-only T04 drop: Drawing and Graph tabs", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  await disableNativeFilePickers(page);
  await page.goto("/");

  await dropGraphText(page, topologyText("T04"), "t04.graphthe.json");
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await expect(
    page.locator('[data-testid="import-report-item"][data-code="layout-applied"]'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("import-verdict")).toBeVisible();
  await shot(page, "import-t04-drawing-light-es");

  await page.getByTestId("import-tab-graph").click();
  await expect(page.getByTestId("import-preview-graph")).toBeVisible();
  await shot(page, "import-t04-graph-light-es");

  expect(pageErrors).toEqual([]);
});

for (const id of ["T08", "T14", "T16"]) {
  test(`canvas after opening ${id} from the atlas (Build mode, auto-fit)`, async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors = trackPageErrors(page);
    await disableNativeFilePickers(page);
    await page.goto("/");
    await page.getByTestId("empty-state-atlas").click();
    await page.locator(`[data-testid="atlas-card"][data-atlas-id="${id}"]`).click();
    await expect(page.getByTestId("atlas-dialog")).toHaveCount(0, { timeout: 60_000 });
    await expect
      .poll(async () => (await readSessionDocument(page).catch(() => null))?.links.length ?? 0)
      .toBe(8);
    await expect.poll(async () => (await getSimStatus(page))?.status).toBe("ready");

    // Back to Build so the drawn reference layout (not a posed frame) is shown.
    await pressSpace(page);
    await page.waitForTimeout(500);
    await shot(page, `atlas-open-${id}-build-light-es`);

    expect(pageErrors).toEqual([]);
  });
}
