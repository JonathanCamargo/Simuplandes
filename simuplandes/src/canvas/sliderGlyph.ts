/**
 * Screen-space geometry for a prismatic joint's glyph: a hatched guide on
 * the rail part (centered on the rail site, siteA) and a block on the
 * sliding part (at siteB). Both are expressed in the glyph's own frame --
 * origin at the rail site's screen point, x along the slide axis (the
 * Konva rotation `angleToKonvaRotationDeg(blockAngle)`) -- so the block's
 * only coordinate is its offset along the axis. The guide grows to keep the
 * block on it. Pure functions over screen pixels, shared by `JointsLayer`
 * (first render), `applyRenderModel` (posed updates) and the SVG export.
 */

import type { Vec2 } from "../geom";

/** Half the guide's minimum length, px. */
const GUIDE_HALF = 24;
/** How far the guide extends past the block's center, px. */
const GUIDE_PAST_BLOCK = 18;
/** The guide line's offset below the axis, px (just under the block). */
export const GUIDE_Y = 8;
/** Hatch mark spacing and depth, px. */
const HATCH_STEP = 8;
const HATCH_DEPTH = 5;
export const BLOCK_WIDTH = 20;
export const BLOCK_HEIGHT = 12;

export interface SliderGlyph {
  /** Flat polyline (glyph frame): the guide line with its hatch marks. */
  guide: number[];
  /** The block's center x (glyph frame); y is 0. */
  blockX: number;
}

/**
 * The glyph for a rail site at screen `rail`, a sliding site at screen
 * `block`, and a Konva rotation of `rotationDeg` (clockwise degrees).
 */
export function sliderGlyph(rail: Vec2, block: Vec2, rotationDeg: number): SliderGlyph {
  const r = (rotationDeg * Math.PI) / 180;
  const blockX = (block.x - rail.x) * Math.cos(r) + (block.y - rail.y) * Math.sin(r);
  const lo = Math.min(-GUIDE_HALF, blockX - GUIDE_PAST_BLOCK);
  const hi = Math.max(GUIDE_HALF, blockX + GUIDE_PAST_BLOCK);
  const guide: number[] = [lo, GUIDE_Y];
  for (let x = lo + HATCH_STEP / 2; x <= hi; x += HATCH_STEP) {
    // Down to the hatch tip and back, so one polyline draws line + hatches.
    guide.push(x, GUIDE_Y, x - HATCH_DEPTH, GUIDE_Y + HATCH_DEPTH, x, GUIDE_Y);
  }
  guide.push(hi, GUIDE_Y);
  return { guide, blockX };
}
