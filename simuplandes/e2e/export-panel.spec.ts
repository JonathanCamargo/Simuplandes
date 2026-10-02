/**
 * Real-browser E2E for the Export tab (XCH-01 / XCH-02 UI): live JSON
 * preview, download == preview, copy == preview, the localized clickable
 * validation report and its canvas halo. Every test collects `pageerror`
 * events and asserts there are none.
 *
 * `showSaveFilePicker` is deleted before `goto` so browser-fs-access falls
 * back to an `<a download>` (a native save dialog cannot be driven).
 */
import { test, expect, type Page } from "@playwright/test";
import { clickCanvasPoint, loadExampleFourBar, readSessionDocument, seedDocument } from "./helpers";
import type { CanvasHaloState } from "../src/canvas/layers/canvasTestHook";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

async function noFilePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker; // browser-fs-access feature-detects on the open picker
  });
}

async function canvasHalo(page: Page, id: string): Promise<CanvasHaloState | null> {
  return page.evaluate((entityId: string) => {
    const hook = window.__simuplandesCanvas;
    if (!hook) throw new Error("window.__simuplandesCanvas is not installed");
    return hook.haloState(entityId);
  }, id);
}

async function openExportWithExample(page: Page): Promise<void> {
  await page.goto("/");
  await loadExampleFourBar(page);
  await page.locator(".MuiBackdrop-root").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Exportar" }).click();
  await expect(page.getByTestId("export-json")).toBeVisible();
}

async function previewText(page: Page): Promise<string> {
  return (await page.getByTestId("export-json").textContent()) ?? "";
}

test("live JSON preview: structure, update on edit, download and copy equal the preview", async ({
  page,
  context,
}) => {
  const pageErrors = trackPageErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await noFilePicker(page);
  await openExportWithExample(page);

  const before = await previewText(page);
  const parsed = JSON.parse(before) as {
    graph: { directed: boolean; multigraph: boolean };
    nodes?: unknown[];
    pos?: unknown;
  };
  expect(parsed.graph.directed).toBe(false);
  expect(parsed.graph.multigraph).toBe(false);
  expect(before).toContain('"input"');

  // Edit the drawing with the real bar tool: the preview must change live.
  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 20, y: 20 * Math.sqrt(3) });
  await clickCanvasPoint(page, { x: 100, y: 0 });
  await page.keyboard.press("Escape");
  await expect.poll(() => previewText(page)).not.toBe(before);
  const after = await previewText(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-download").click(),
  ]);
  expect(download.suggestedFilename().endsWith(".graphthe.json")).toBe(true);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const content = Buffer.concat(chunks).toString("utf8");
  expect(content.trimEnd()).toBe(after.trimEnd());

  await page.getByTestId("export-copy").click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  // The Windows clipboard turns LF into CRLF on read-back; compare modulo that.
  expect(clip.replaceAll("\r\n", "\n").trimEnd()).toBe(after.trimEnd());

  expect(pageErrors).toEqual([]);
});

test("no motor: localized error item; clicking a report item halos canvas links", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  await noFilePicker(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  const base = await readSessionDocument(page);
  await page.getByRole("tab", { name: "Exportar" }).click();

  // The clean four-bar has a motor: ready line, no errors.
  await expect(page.getByTestId("export-report-empty")).toBeVisible();

  // Reload with the motor removed (same seed path a returning user takes).
  const page2 = await page.context().newPage();
  await noFilePicker(page2);
  await seedDocument(page2, { ...base, motors: [] });
  await page2.goto("/");
  await page2.getByRole("tab", { name: "Exportar" }).click();

  const noMotor = page2.locator(
    '[data-testid="export-report-item"][data-code="cannot-simulate-no-motor"]',
  );
  await expect(noMotor).toHaveAttribute("data-severity", "error");
  await expect(noMotor).toContainText("GraphThe no podrá simular esto");

  await page2.click('button:has-text("EN")');
  await expect(noMotor).toContainText("GraphThe won't be able to simulate this");
  await page2.click('button:has-text("ES")');
  await expect(noMotor).toContainText("GraphThe no podrá simular esto");

  // Halo: a redundant bar (F = 0) yields a report item tied to links.
  await page2.click('[data-tool-id="bar"]');
  await page2
    .locator(".MuiBackdrop-root")
    .waitFor({ state: "detached" })
    .catch(() => {});
  await clickCanvasPoint(page2, { x: 20, y: 20 * Math.sqrt(3) });
  await clickCanvasPoint(page2, { x: 100, y: 0 });
  await page2.keyboard.press("Escape");

  const items = page2.getByTestId("export-report-item");
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  let haloed = false;
  const doc2 = await readSessionDocument(page2);
  for (let i = 0; i < count && !haloed; i++) {
    await items.nth(i).click();
    for (const link of doc2.links) {
      const halo = await canvasHalo(page2, link.id);
      if (halo && (halo.hovered || halo.selected)) {
        haloed = true;
        break;
      }
    }
  }
  expect(haloed).toBe(true);

  expect(pageErrors).toEqual([]);
  await page2.close();
});
