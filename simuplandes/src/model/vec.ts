/**
 * Conversions between the document's compact JSON tuple representation of a
 * 2D point (`[x, y]`) and `src/geom`'s `Vec2` (`{x, y}`) object shape.
 */

import { type Vec2, vec2 } from "../geom";

/** A JSON-friendly 2D point: `[x, y]`. */
export type Vec2Tuple = [number, number];

/** Normalizes `-0` to `+0` so JSON round-trips (`stringify` -> `parse`) stay deep-equal. */
export function cleanNumber(n: number): number {
  return n + 0;
}

/** Converts a JSON tuple to a `Vec2`. */
export function toVec2(t: readonly [number, number]): Vec2 {
  return vec2(t[0], t[1]);
}

/** Converts a `Vec2` to a JSON tuple, normalizing `-0` to `+0` in both components. */
export function toTuple(v: Vec2): Vec2Tuple {
  return [cleanNumber(v.x), cleanNumber(v.y)];
}
