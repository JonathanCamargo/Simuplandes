/**
 * Real-browser E2E for XCH-09: the Export tab's four image actions. SVG is
 * transparent, PNG is opaque white at 2x, "Print (light)" forces light
 * tokens even in the dark theme, and the drawing export is WYSIWYG for the
 * Simulate pose. Every test collects `pageerror` events.
 */
import { test, expect, type Page } from "@playwright/test";
import { loadExampleFourBar, pressSpace } from "./helpers";

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

async function openExportTab(page: Page): Promise<void> {
  await page.goto("/");
  await loadExampleFourBar(page);
  await page.locator(".MuiBackdrop-root").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Exportar" }).click();
  await expect(page.getByTestId("export-image-actions")).toBeVisible();
}

interface Downloaded {
  name: string;
  bytes: Buffer;
}

async function download(page: Page, testId: string): Promise<Downloaded> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { name: dl.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

function svgSize(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const w = Number(/\swidth="([\d.]+)(?:px)?"/.exec(root)?.[1]);
  const h = Number(/\sheight="([\d.]+)(?:px)?"/.exec(root)?.[1]);
  if (Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h };
  // The graph SVG may size itself in percent; its viewBox is 1 unit == 1 CSS px.
  const vb = /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(root);
  return { width: Number(vb?.[1]), height: Number(vb?.[2]) };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function firstPixel(page: Page, bytes: Buffer): Promise<number[]> {
  return page.evaluate(async (b64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, bytes.toString("base64"));
}

/** True if the svg paints a rect covering its whole canvas (a background). */
function hasBackgroundRect(svg: string): boolean {
  const { width, height } = svgSize(svg);
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const tag = m[0];
    const w = /\swidth="([\d.%]+)"/.exec(tag)?.[1];
    const h = /\sheight="([\d.%]+)"/.exec(tag)?.[1];
    if (w === "100%" && h === "100%") return true;
    if (Number(w) >= width && Number(h) >= height) return true;
  }
  return false;
}

test("four image actions: SVG transparent, PNG opaque white at 2x", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await noFilePicker(page);
  await openExportTab(page);

  for (const [kind, svgId, pngId] of [
    ["drawing", "export-drawing-svg", "export-drawing-png"],
    ["graph", "export-graph-svg", "export-graph-png"],
  ] as const) {
    const svgFile = await download(page, svgId);
    expect(svgFile.name.endsWith(`-${kind}.svg`)).toBe(true);
    const svg = svgFile.bytes.toString("utf8");
    expect(svg.trimStart().startsWith("<svg") || svg.trimStart().startsWith("<?xml")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(hasBackgroundRect(svg)).toBe(false);
    const dims = svgSize(svg);
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);

    const pngFile = await download(page, pngId);
    expect(pngFile.name.endsWith(`-${kind}.png`)).toBe(true);
    const png = pngSize(pngFile.bytes);
    expect(png.width).toBe(dims.width * 2);
    expect(png.height).toBe(dims.height * 2);
    expect(await firstPixel(page, pngFile.bytes)).toEqual([255, 255, 255, 255]);
  }

  expect(pageErrors).toEqual([]);
});

test("Print (light) in the dark theme exports the light-theme drawing", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await noFilePicker(page);
  await openExportTab(page);
  await page.mouse.move(2, 2);

  const light = (await download(page, "export-drawing-svg")).bytes.toString("utf8");

  await page.click('button:has-text("EN")');
  await page.click('button[aria-label="Dark"]');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  const dark = (await download(page, "export-drawing-svg")).bytes.toString("utf8");
  expect(dark).not.toBe(light);

  await page.getByTestId("export-print-light").click();
  const darkPrintLight = (await download(page, "export-drawing-svg")).bytes.toString("utf8");
  expect(darkPrintLight).toBe(light);

  expect(pageErrors).toEqual([]);
});

test("Simulate mode: the drawing export uses the scrubbed pose", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await noFilePicker(page);
  await openExportTab(page);
  await page.mouse.move(2, 2);

  const build = (await download(page, "export-drawing-svg")).bytes.toString("utf8");

  await pressSpace(page);
  const slider = page.getByRole("slider", { name: /Entrada/ });
  await slider.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");

  const simulated = (await download(page, "export-drawing-svg")).bytes.toString("utf8");
  expect(simulated).not.toBe(build);
  // Same canvas box, different geometry.
  expect(svgSize(simulated)).toEqual(svgSize(build));

  expect(pageErrors).toEqual([]);
});
