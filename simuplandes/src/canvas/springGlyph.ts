/**
 * Screen-space geometry for the spring and load glyphs: a zigzag between
 * two points for a linear spring, a spiral for a torsional one, and the
 * arrow lengths for loads. Pure functions over screen pixels, shared by
 * `JointsLayer` (first render) and `applyRenderModel` (posed updates).
 */

import type { Vec2 } from "../geom";

/** Peaks in a linear spring's zigzag. */
export const SPRING_PEAKS = 8;
/** Half-height of the zigzag, px. */
export const SPRING_AMPLITUDE = 5;
/** Straight lead at each end, as a fraction of the length. */
const LEAD_FRACTION = 0.15;
/** Length of a load's force arrow, px. */
export const LOAD_ARROW_LENGTH = 32;

/** Flat `[x0, y0, x1, y1, ...]` zigzag from `a` to `b` (screen px). Collapses to a line when they coincide. */
export function springZigzag(a: Vec2, b: Vec2): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return [a.x, a.y, b.x, b.y];
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const lead = length * LEAD_FRACTION;
  const body = length - 2 * lead;
  const points = [a.x, a.y, a.x + ux * lead, a.y + uy * lead];
  for (let i = 0; i < SPRING_PEAKS; i++) {
    const along = lead + (body * (i + 0.5)) / SPRING_PEAKS;
    const side = i % 2 === 0 ? 1 : -1;
    points.push(
      a.x + ux * along + nx * SPRING_AMPLITUDE * side,
      a.y + uy * along + ny * SPRING_AMPLITUDE * side,
    );
  }
  points.push(b.x - ux * lead, b.y - uy * lead, b.x, b.y);
  return points;
}

/** Flat points of a small spiral centred on the origin (px), for a torsional spring. */
export function torsionalSpiral(turns = 1.75, outerRadius = 13, samples = 40): number[] {
  const points: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = t * turns * 2 * Math.PI;
    const radius = outerRadius * (0.35 + 0.65 * t);
    points.push(radius * Math.cos(angle), -radius * Math.sin(angle));
  }
  return points;
}
