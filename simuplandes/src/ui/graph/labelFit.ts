/**
 * `fitLabel`: pure, deterministic label-fitting for a node's `<text>` (no
 * DOM measurement -- jsdom has no `getBBox`/`getComputedTextLength`, and a
 * measurement-based approach would need a real browser layout pass just to
 * unit-test). Shrinks the font size to fit `maxWidth` (down to
 * `LABEL_MIN_FONT`), then truncates with an ellipsis if even the minimum
 * font size doesn't fit. The caller (`GraphSvg`) always keeps the full,
 * untruncated name in the node's `<title>`/`aria-label`.
 *
 * 06-09: units are now real screen px (`GraphSvg`'s viewBox equals its
 * measured CSS-px size, 1 SVG unit == 1 CSS px), not viewBox units -- so
 * `LABEL_MAX_FONT`/`LABEL_MIN_FONT` are themselves the actual on-screen
 * legibility floor/ceiling a label ever renders at, regardless of how much
 * the flex layout compresses the SVG's own box.
 */

/** Largest font size a label ever renders at (screen px). */
export const LABEL_MAX_FONT = 12;
/** Smallest font size before truncation kicks in (screen px) -- the legibility floor; never render smaller than this. */
export const LABEL_MIN_FONT = 11;
/** Conservative average glyph width as a fraction of font size (sans-serif, mixed case). */
export const GLYPH_WIDTH_EM = 0.62;

export interface FittedLabel {
  text: string;
  fontSize: number;
  truncated: boolean;
}

/**
 * Fits `label` inside `maxWidth` (viewBox units), shrinking the font size
 * first, then truncating with a trailing "…" once `LABEL_MIN_FONT` still
 * doesn't fit. Empty labels are returned untouched at the max font size.
 */
export function fitLabel(label: string, maxWidth: number): FittedLabel {
  const chars = [...label];
  const n = chars.length;
  if (n === 0) {
    return { text: "", fontSize: LABEL_MAX_FONT, truncated: false };
  }

  const fontSize = Math.min(LABEL_MAX_FONT, Math.floor(maxWidth / (n * GLYPH_WIDTH_EM)));
  if (fontSize >= LABEL_MIN_FONT) {
    return { text: label, fontSize, truncated: false };
  }

  const k = Math.max(1, Math.floor(maxWidth / (LABEL_MIN_FONT * GLYPH_WIDTH_EM)) - 1);
  const text = `${chars.slice(0, k).join("")}…`;
  return { text, fontSize: LABEL_MIN_FONT, truncated: true };
}
