/**
 * Unit and angle conventions for the mechanism document (MDL-05):
 * - World coordinates are y-up, model units (`units.length`: `"mm"` default
 *   or `"m"`, a label only — no runtime conversion between units in this
 *   phase).
 * - Angles are stored in radians everywhere inside the document and are
 *   converted to degrees only at the UI edge, via `radToDeg`/`formatAngle`.
 */

/** The supported length unit labels. */
export const LENGTH_UNITS = ["mm", "m"] as const;

/** A length unit label (`"mm"` or `"m"`). No runtime conversion is implied. */
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** The default length unit for a new document. */
export const DEFAULT_LENGTH_UNIT: LengthUnit = "mm";

/** Converts radians to degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Converts degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Formats an angle (radians) as a degree string, e.g. `"30.0°"`. Never emits `"-0.0°"`. */
export function formatAngle(rad: number, fractionDigits = 1): string {
  const degrees = radToDeg(rad);
  const rounded = Number(degrees.toFixed(fractionDigits)) + 0; // normalize -0 -> 0
  return `${rounded.toFixed(fractionDigits)}°`;
}

/** Formats a length value with its unit label, e.g. `"12.50 mm"`. */
export function formatLength(value: number, unit: LengthUnit, fractionDigits = 2): string {
  return `${value.toFixed(fractionDigits)} ${unit}`;
}
