/**
 * WCAG 2.x contrast math (pure). Used by `contrast.test.ts` to enforce the
 * WCAG 1.4.11 (non-text, 3:1) contrast contract for the link-type palette.
 */

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;

function channelToLinear(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parses a strict `#RRGGBB` hex color. Throws for any other format. */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (!match) {
    throw new Error(`Expected a "#RRGGBB" hex color, got "${hex}"`);
  }
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** WCAG relative luminance of a `#RRGGBB` color, in `[0, 1]`. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const R = channelToLinear(r);
  const G = channelToLinear(g);
  const B = channelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two `#RRGGBB` colors, in `[1, 21]`. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
