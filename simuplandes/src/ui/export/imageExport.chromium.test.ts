/**
 * Real-Chromium coverage for `svgTextToPngBlob` (jsdom cannot decode an
 * `Image`/rasterize a `<canvas>` reliably -- research's own note). Proves
 * the PNG is `scale`x the CSS size and has a real, opaque `background`
 * painted BEFORE the SVG content (Pitfall 7), never a transparent PNG.
 */

import { describe, it, expect } from "vitest";
import { svgTextToPngBlob } from "./imageExport";

const WIDTH = 40;
const HEIGHT = 30;

/** A minimal, transparent-background SVG: a red square filling most of the box, with a gap at the top-left corner. */
function svgText(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect x="10" y="10" width="20" height="10" fill="#FF0000" />` +
    `</svg>`
  );
}

async function decodePixels(
  blob: Blob,
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, ctx };
}

describe("svgTextToPngBlob (real Chromium)", () => {
  it("decodes to widthPx*scale x heightPx*scale", async () => {
    const blob = await svgTextToPngBlob(svgText(), { widthPx: WIDTH, heightPx: HEIGHT, scale: 2 });
    expect(blob.type).toBe("image/png");
    const { canvas } = await decodePixels(blob);
    expect(canvas.width).toBe(WIDTH * 2);
    expect(canvas.height).toBe(HEIGHT * 2);
  });

  it("pixel (0,0) is opaque white -- the painted background, not a transparent default", async () => {
    const blob = await svgTextToPngBlob(svgText(), { widthPx: WIDTH, heightPx: HEIGHT, scale: 2 });
    const { ctx } = await decodePixels(blob);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    expect([r, g, b, a]).toEqual([255, 255, 255, 255]);
  });

  it("a pixel under the drawn red square is not white", async () => {
    const blob = await svgTextToPngBlob(svgText(), { widthPx: WIDTH, heightPx: HEIGHT, scale: 2 });
    const { ctx } = await decodePixels(blob);
    // The red rect covers x in [10,30), y in [10,20) at CSS scale -- at 2x, (40,30) is well inside it.
    const [r, g, b] = ctx.getImageData(40, 30, 1, 1).data;
    expect([r, g, b]).not.toEqual([255, 255, 255]);
    expect(r).toBeGreaterThan(g);
  });

  it("honors a custom background color", async () => {
    const blob = await svgTextToPngBlob(svgText(), {
      widthPx: WIDTH,
      heightPx: HEIGHT,
      scale: 1,
      background: "#0000FF",
    });
    const { ctx } = await decodePixels(blob);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    expect([r, g, b, a]).toEqual([0, 0, 255, 255]);
  });
});
