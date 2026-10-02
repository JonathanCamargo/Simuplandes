/**
 * Pure grid-spacing and grid/ruler line generation, driven by a `Viewport`.
 * No React/Konva -- layers map these into screen-space Konva shapes.
 */

import { screenToWorld, worldToScreen, type Viewport } from "./viewport";
import type { Bounds } from "./bounds";

const STEPS = [1, 2, 5] as const;
const EPS = 1e-9;

/**
 * The smallest spacing in `{1,2,5} x 10^k` world units whose on-screen size
 * (`spacing * zoom`) is at least `minPx` (default 12).
 */
export function gridSpacingFor(zoom: number, minPx = 12): number {
  if (!(zoom > 0)) return STEPS[0];

  let k = Math.floor(Math.log10(minPx / zoom)) - 2;
  // `k` only ever increases and `spacing * zoom` grows without bound, so
  // this always terminates within a handful of iterations.
  for (;;) {
    for (const step of STEPS) {
      const spacing = step * Math.pow(10, k);
      if (spacing * zoom >= minPx - EPS) {
        return spacing;
      }
    }
    k++;
  }
}

/** Returns which of `{1,2,5}` a `gridSpacingFor`-produced spacing is a multiple of. */
function stepDigitOf(spacing: number): 1 | 2 | 5 {
  const exp = Math.floor(Math.log10(spacing) + EPS);
  const mantissa = spacing / Math.pow(10, exp);
  if (mantissa < 1.5) return 1;
  if (mantissa < 3.5) return 2;
  return 5;
}

/** Every minor line is major every `majorEvery` steps: 5 minor lines per major, except for a 5x10^k spacing (every 2). */
function majorEveryFor(spacing: number): number {
  return stepDigitOf(spacing) === 5 ? 2 : 5;
}

export interface VerticalGridLine {
  screenX: number;
  worldX: number;
  major: boolean;
  axis: boolean;
}

export interface HorizontalGridLine {
  screenY: number;
  worldY: number;
  major: boolean;
  axis: boolean;
}

export interface GridLines {
  vertical: VerticalGridLine[];
  horizontal: HorizontalGridLine[];
}

function visibleWorldBounds(v: Viewport): Bounds {
  const corners = [
    screenToWorld(v, { x: 0, y: 0 }),
    screenToWorld(v, { x: v.widthPx, y: 0 }),
    screenToWorld(v, { x: 0, y: v.heightPx }),
    screenToWorld(v, { x: v.widthPx, y: v.heightPx }),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}

/** The grid lines (minor + major, plus the axes) visible within `v` at `spacing`. */
export function gridLines(v: Viewport, spacing: number): GridLines {
  const bounds = visibleWorldBounds(v);
  const majorEvery = majorEveryFor(spacing);

  const vertical: VerticalGridLine[] = [];
  const firstX = Math.ceil(bounds.min.x / spacing - EPS) * spacing;
  for (let x = firstX; x <= bounds.max.x + EPS; x += spacing) {
    const index = Math.round(x / spacing);
    vertical.push({
      screenX: worldToScreen(v, { x, y: 0 }).x,
      worldX: index * spacing,
      major: index % majorEvery === 0,
      axis: Math.abs(x) < spacing * EPS,
    });
  }

  const horizontal: HorizontalGridLine[] = [];
  const firstY = Math.ceil(bounds.min.y / spacing - EPS) * spacing;
  for (let y = firstY; y <= bounds.max.y + EPS; y += spacing) {
    const index = Math.round(y / spacing);
    horizontal.push({
      screenY: worldToScreen(v, { x: 0, y }).y,
      worldY: index * spacing,
      major: index % majorEvery === 0,
      axis: Math.abs(y) < spacing * EPS,
    });
  }

  return { vertical, horizontal };
}

export interface RulerTick {
  screen: number;
  world: number;
}

/** Ticks for the visible major grid lines along `axis`, for the ruler layer. */
export function rulerTicks(v: Viewport, axis: "x" | "y"): RulerTick[] {
  const spacing = gridSpacingFor(v.zoom);
  const lines = gridLines(v, spacing);
  if (axis === "x") {
    return lines.vertical
      .filter((l) => l.major)
      .map((l) => ({ screen: l.screenX, world: l.worldX }));
  }
  return lines.horizontal
    .filter((l) => l.major)
    .map((l) => ({ screen: l.screenY, world: l.worldY }));
}
