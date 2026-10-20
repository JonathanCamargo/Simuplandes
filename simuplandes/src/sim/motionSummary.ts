/**
 * A plain-language summary of how a mechanism moves over its sweep, read from
 * the sweep's measurement table: which links turn a full circle, which
 * oscillate and through what angle, which only translate, and how large each
 * marker's coupler curve is. Pure data, for the Inspector's motion card.
 */

import type { MeasurementTable } from "./plots";

/** How one moving link behaves over the sweep. */
export type LinkMotion =
  | { readonly kind: "rotates"; readonly turns: number }
  | { readonly kind: "oscillates"; readonly minDeg: number; readonly maxDeg: number }
  | { readonly kind: "translates" };

export interface LinkMotionSummary {
  readonly linkId: string;
  readonly label: string;
  readonly motion: LinkMotion;
}

export interface MarkerMotionSummary {
  readonly markerId: string;
  readonly label: string;
  /** Size of the curve's bounding box, in model length units. */
  readonly width: number;
  readonly height: number;
}

export interface MotionSummary {
  readonly links: readonly LinkMotionSummary[];
  readonly markers: readonly MarkerMotionSummary[];
}

/** Below this angular span (degrees) a link is treated as not rotating at all. */
const STILL_SPAN_DEG = 0.05;
/** A net change within this many degrees of a multiple of 360 counts as whole turns. */
const TURN_TOLERANCE_DEG = 1;

function columnRange(column: Float64Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of column) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function classifyAngle(column: Float64Array): LinkMotion {
  const { min, max } = columnRange(column);
  if (max - min < STILL_SPAN_DEG) return { kind: "translates" };
  const net = column[column.length - 1] - column[0];
  const turns = Math.round(net / 360);
  if (turns !== 0 && Math.abs(net - turns * 360) <= TURN_TOLERANCE_DEG) {
    return { kind: "rotates", turns: Math.abs(turns) };
  }
  return { kind: "oscillates", minDeg: min, maxDeg: max };
}

/**
 * Summarizes `table` (a sweep "vs input" table, angles unwrapped in degrees).
 * Links appear in table order; a marker appears once both its x and y
 * columns are present. Returns empty lists for an empty table.
 */
export function summarizeMotion(table: MeasurementTable | null): MotionSummary {
  if (table === null || table.length === 0) return { links: [], markers: [] };

  const links: LinkMotionSummary[] = [];
  const markerColumns = new Map<string, { label: string; x?: Float64Array; y?: Float64Array }>();

  table.quantities.forEach((quantity, index) => {
    const column = table.columns[index];
    if (quantity.entityKind === "link" && quantity.token === "angle") {
      links.push({
        linkId: quantity.entityId,
        label: quantity.entityLabel,
        motion: classifyAngle(column),
      });
    } else if (
      quantity.entityKind === "marker" &&
      (quantity.token === "x" || quantity.token === "y")
    ) {
      const entry = markerColumns.get(quantity.entityId) ?? { label: quantity.entityLabel };
      entry[quantity.token] = column;
      markerColumns.set(quantity.entityId, entry);
    }
  });

  const markers: MarkerMotionSummary[] = [];
  for (const [markerId, entry] of markerColumns) {
    if (!entry.x || !entry.y) continue;
    const xs = columnRange(entry.x);
    const ys = columnRange(entry.y);
    markers.push({
      markerId,
      label: entry.label,
      width: xs.max - xs.min,
      height: ys.max - ys.min,
    });
  }

  return { links, markers };
}
