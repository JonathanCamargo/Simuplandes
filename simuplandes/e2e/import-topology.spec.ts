/**
 * SC-2 / XCH-06 (real browser): a topology-only 8-bar (atlas T04, the hardest
 * measured case) with no positions and no input is dropped, laid out, imported,
 * assembles, and its input travels at least 60 degrees while playing.
 *
 * The graph text is built from `src/graph/atlas/eightbar.json` via `fs` (not
 * `atlasData.ts`, whose `import.meta.glob` cannot load in Node-side Playwright).
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import {
  disableNativeFilePickers,
  dropGraphText,
  getSimInput,
  getSimMode,
  getSimPoses,
  getSimStatus,
  maxJointResidual,
  readSessionDocument,
} from "./helpers";

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

test("a dropped topology-only T04 lays out, imports, assembles and moves >= 60 degrees", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await disableNativeFilePickers(page);
  await page.goto("/");

  await dropGraphText(page, topologyText("T04"), "t04.graphthe.json");
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toBeVisible();

  const item = (code: string) =>
    page.locator(`[data-testid="import-report-item"][data-code="${code}"]`);
  await expect(item("layout-applied")).toBeVisible({ timeout: 60_000 });
  await expect(item("layout-applied")).toHaveAttribute("data-severity", "info");
  await expect(item("missing-input")).toBeVisible();
  await expect(item("missing-input")).toHaveAttribute("data-severity", "warning");
  await expect(page.getByTestId("import-tab-drawing")).toBeVisible();
  await expect(page.getByTestId("import-tab-graph")).toBeVisible();

  // The verdict of the exact document about to be committed.
  const verdict = page.getByTestId("import-verdict");
  await expect(verdict).toHaveAttribute("data-status", "ready");
  const rangeDeg = Number(await verdict.getAttribute("data-range-deg"));
  expect(rangeDeg).toBeGreaterThanOrEqual(60);

  await page.getByTestId("import-commit").click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await readSessionDocument(page).catch(() => null))?.links.length ?? 0)
    .toBe(8);
  await expect.poll(() => getSimMode(page)).toBe("simulate");
  await expect.poll(async () => (await getSimStatus(page))?.status).toBe("ready");

  // Loop is on, so a bounded motor rocks between its lock-ups: measure the span.
  await expect(page.getByRole("checkbox", { name: "Repetir" })).toBeChecked();
  await page.getByRole("button", { name: "Reproducir" }).click();

  let min = Infinity;
  let max = -Infinity;
  let worstResidual = 0;
  const doc = await readSessionDocument(page);
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const input = (await getSimInput(page))?.input ?? 0;
    min = Math.min(min, input);
    max = Math.max(max, input);
    worstResidual = Math.max(worstResidual, maxJointResidual(doc, await getSimPoses(page)));
    if (((max - min) * 180) / Math.PI >= 60 + 5) break;
    await page.waitForTimeout(100);
  }
  const spanDeg = ((max - min) * 180) / Math.PI;
  test.info().annotations.push({
    type: "measured",
    description: `verdict range ${rangeDeg.toFixed(1)} deg, played input span ${spanDeg.toFixed(1)} deg`,
  });
  expect(spanDeg).toBeGreaterThanOrEqual(60);
  expect(worstResidual).toBeLessThan(1e-3 * 100);
  expect(pageErrors).toEqual([]);
});
