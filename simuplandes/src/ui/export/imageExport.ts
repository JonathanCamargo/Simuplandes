/**
 * SVG -> `Blob`/PNG-`Blob` conversion for the drawing/graph image export
 * (XCH-09), plus the `<slug>-drawing.svg`/`<slug>-graph.png` file-name rule.
 *
 * `svgTextToPngBlob` rasterizes the SAME svg text `renderDrawingSvgText`/
 * `renderGraphSvgText` already produced onto an offscreen `<canvas>` at
 * `scale`x its CSS size, painting a solid `background` rect FIRST (research
 * Pitfall 7: both Konva canvases and SVG documents are transparent by
 * default; a canvas 2D context is too -- nothing paints white on its own).
 * This only really works in a real browser (real `Image`/`canvas` decode);
 * see `imageExport.chromium.test.ts` for the real-Chromium pixel assertions.
 */

import { slugifyName } from "../../persistence/fileIO";
import type { MechanismDocument } from "../../model";

export type ImageKind = "drawing" | "graph";
export type ImageFormat = "svg" | "png";

/** `<slug>-drawing.svg`/`<slug>-graph.png` etc. (same slug rule as `<slug>.simup.json`; "mechanism" when `doc.name` is empty). */
export function imageFileName(
  doc: Pick<MechanismDocument, "name">,
  kind: ImageKind,
  format: ImageFormat,
): string {
  const slug = slugifyName(doc.name);
  return `${slug === "" ? "mechanism" : slug}-${kind}.${format}`;
}

/** Wraps `svgText` in an `image/svg+xml;charset=utf-8` `Blob`, byte-equal to the input text. */
export function svgTextToBlob(svgText: string): Blob {
  return new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
}

export interface SvgToPngOptions {
  widthPx: number;
  heightPx: number;
  /** Rasterization scale (CSS-px -> device-px); default 2 (XCH-09's "PNG at 2x"). */
  scale?: number;
  /** Solid PNG background color, painted before the SVG is drawn on top; default opaque white. */
  background?: string;
}

/**
 * Rasterizes `svgText` onto a `background`-filled canvas at `scale`x its
 * `widthPx`/`heightPx` CSS size, returning an `image/png` `Blob`. Requires a
 * real `Image`/`canvas` decode (a real browser -- see
 * `imageExport.chromium.test.ts`).
 */
export async function svgTextToPngBlob(svgText: string, options: SvgToPngOptions): Promise<Blob> {
  const { widthPx, heightPx, scale = 2, background = "#FFFFFF" } = options;

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  const image = new Image();
  image.src = dataUrl;
  if (typeof image.decode === "function") {
    await image.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode SVG image"));
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = widthPx * scale;
  canvas.height = heightPx * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Paint the background FIRST (research Pitfall 7) -- both Konva's own
  // toDataURL and a bare SVG-to-canvas rasterization are transparent by
  // default, and CONTEXT wants a white (or `background`) PNG.
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}
