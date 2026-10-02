/**
 * Manual-review artifacts for the orchestrator's visual pass (06-VALIDATION's
 * one manual-only row, GRF-05): the Graph panel's three layouts (Espacial /
 * Circular / Por capas) for a Stephenson six-bar, in light and dark, plus
 * one screenshot of the SC-3 rigid-triangle issue-highlight case in light.
 * 06-09 additionally saves a native-resolution element crop of
 * `[data-testid="graph-panel"]` per layout (light theme) so node/label
 * legibility can be reviewed without the full-page screenshot's surrounding
 * chrome. Still asserts there are no `pageerror`s.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { documentFromEdges } from "../src/graph/__fixtures__/fromEdges";
import { buildStephensonIII } from "../src/kinematics/__fixtures__/sixBars";
import { seedDocument } from "./helpers";

test.use({ viewport: { width: 1280, height: 720 } });

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

const OUT_DIR = "test-results/graph-screenshots";

function assertNonEmpty(filePath: string): void {
  const stat = fs.statSync(filePath);
  expect(stat.size).toBeGreaterThan(0);
}

const LAYOUTS: readonly { kind: string; label: string }[] = [
  { kind: "spatial", label: "Espacial" },
  { kind: "circular", label: "Circular" },
  { kind: "layered", label: "Por capas" },
];

test("Graph layout screenshots (light/dark) for a Stephenson six-bar, plus the SC-3 triangle case", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await seedDocument(page, buildStephensonIII().doc);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();

  for (const layout of LAYOUTS) {
    await page.getByRole("button", { name: layout.label, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const filePath = path.join(OUT_DIR, `stephenson-${layout.kind}-light.png`);
    await page.screenshot({ path: filePath });
    assertNonEmpty(filePath);

    const panelPath = path.join(OUT_DIR, `stephenson-${layout.kind}-light-panel.png`);
    await page.locator('[data-testid="graph-panel"]').screenshot({ path: panelPath });
    assertNonEmpty(panelPath);
  }

  await page.click('button[aria-label="Oscuro"]');
  for (const layout of LAYOUTS) {
    await page.getByRole("button", { name: layout.label, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const filePath = path.join(OUT_DIR, `stephenson-${layout.kind}-dark.png`);
    await page.screenshot({ path: filePath });
    assertNonEmpty(filePath);
  }
  await page.click('button[aria-label="Claro"]');

  // The SC-3 issue-highlight case, light theme, fresh load (theme has no
  // localStorage persistence -- a fresh goto always defaults to the system
  // preference, which is "light" in this headless Chromium run).
  const { doc } = documentFromEdges(
    [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [2, 4],
      [4, 5],
      [5, 2],
    ],
    { name: "Triangle on four-bar" },
  );
  await seedDocument(page, doc);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();
  await page.evaluate(() => document.fonts.ready);
  const triangleFilePath = path.join(OUT_DIR, "baranov-triangle-light.png");
  await page.screenshot({ path: triangleFilePath });
  assertNonEmpty(triangleFilePath);

  expect(pageErrors).toEqual([]);
});
