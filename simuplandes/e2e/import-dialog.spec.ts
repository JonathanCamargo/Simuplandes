/**
 * SC-3 (real browser): the import dialog lists missing-input, multi-joint and
 * unsupported-joint items, each with its fix; choosing a fix re-plans; texts
 * are localized (es default, en on toggle); unparseable text disables Import.
 */
import { test, expect, type Page } from "@playwright/test";
import { disableNativeFilePickers, pasteImportText, readSessionDocument } from "./helpers";

// Inline graph texts (src/interchange/__fixtures__ pulls in `import.meta.glob`,
// which Node-side Playwright cannot load).
interface EdgeSpec {
  source: number;
  target: number;
  pos: [number, number];
  input?: boolean;
  type?: string;
}

function graphText(edges: EdgeSpec[]): string {
  return JSON.stringify({ nodes: [0, 1, 2, 3].map((id) => ({ id })), edges });
}

const FOURBAR_NO_INPUT: EdgeSpec[] = [
  { source: 0, target: 1, pos: [0, 0] },
  { source: 0, target: 3, pos: [100, 0] },
  { source: 1, target: 2, pos: [20, 34.64101615137754] },
  { source: 2, target: 3, pos: [110, 80] },
];

const missingInput = (): string => graphText(FOURBAR_NO_INPUT);

const unknownJointType = (): string =>
  graphText(
    FOURBAR_NO_INPUT.map((e) =>
      e.source === 1 && e.target === 2 ? { ...e, type: "spherical" } : e,
    ),
  );

/** Ground's two joints coincide at (0, 0): three links meet there. */
const multiJointStar = (): string =>
  graphText([
    { source: 0, target: 1, pos: [0, 0], input: true },
    { source: 0, target: 2, pos: [0, 0] },
    { source: 1, target: 3, pos: [40, 30] },
    { source: 2, target: 3, pos: [-30, 50] },
  ]);

function item(page: Page, code: string) {
  return page.locator(`[data-testid="import-report-item"][data-code="${code}"]`);
}

test.beforeEach(async ({ page }) => {
  await disableNativeFilePickers(page);
  await page.goto("/");
});

test("missing-input: choose another ground edge, import, the motor sits on it", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (e) => pageErrors.push(e));
  await pasteImportText(page, missingInput());

  const missing = item(page, "missing-input");
  await expect(missing).toBeVisible();
  await expect(missing.locator('[data-fix-id="input-0-1"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await missing.locator('[data-fix-id="input-0-3"]').click();
  await expect(item(page, "missing-input").locator('[data-fix-id="input-0-3"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expect(page.getByTestId("import-verdict")).toBeVisible();
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-dialog")).toHaveCount(0);

  await expect
    .poll(async () => {
      const doc = await readSessionDocument(page).catch(() => null);
      if (!doc || doc.motors.length === 0) return null;
      return doc.joints.find((j) => j.id === doc.motors[0].jointId)?.name ?? null;
    })
    .toBe("0-3");
  expect(pageErrors).toEqual([]);
});

test("multi-joint star shows an info item with its fix", async ({ page }) => {
  await pasteImportText(page, multiJointStar());
  const info = item(page, "multi-joint");
  await expect(info).toBeVisible();
  await expect(info).toHaveAttribute("data-severity", "info");
  await expect(info.locator('[data-fix-id="keep-star"]')).toBeVisible();
});

test("unsupported-joint: revolute/skip fixes; skip drops a joint in the Graph preview", async ({
  page,
}) => {
  await pasteImportText(page, unknownJointType());
  const unsupported = item(page, "unsupported-joint");
  await expect(unsupported).toBeVisible();
  await expect(unsupported.locator('[data-fix-id="revolute"]')).toBeVisible();
  await expect(unsupported.locator('[data-fix-id="skip"]')).toBeVisible();

  await page.getByTestId("import-tab-graph").click();
  const edges = page.getByTestId("import-preview-graph").getByTestId("graph-edge");
  await expect(edges).toHaveCount(4);
  await unsupported.locator('[data-fix-id="skip"]').click();
  await expect(edges).toHaveCount(3);
});

test("report text is localized and switches live to English", async ({ page }) => {
  await pasteImportText(page, missingInput());
  const missing = item(page, "missing-input");
  await expect(missing).toContainText("No hay arista de entrada");
  const spanish = (await missing.textContent()) ?? "";

  await page.keyboard.press("Escape");
  await page.click('button:has-text("EN")');
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Import graph…" }).click();
  await page.getByTestId("import-paste").fill(missingInput());
  await expect(missing).toContainText("No input (motor) edge is marked");
  expect((await missing.textContent()) ?? "").not.toBe(spanish);
});

test("unparseable text disables Import", async ({ page }) => {
  await pasteImportText(page, "this is not json");
  await expect(item(page, "unparseable")).toBeVisible();
  await expect(page.getByTestId("import-commit")).toBeDisabled();
});
