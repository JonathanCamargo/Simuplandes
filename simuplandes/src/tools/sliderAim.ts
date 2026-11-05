/**
 * Aiming shared by the Slider and Slider + revolute tools: while the axis
 * is aimed from the anchor, the moving link under the pointer (if any) is
 * the rail the prismatic joint slides along, and over a bar the axis snaps
 * to that bar's direction. Otherwise the rail is ground and the axis
 * follows the 15deg angle snap or the cursor direction.
 */

import { direction, dot, fromPolar, magnitude, sub, type Vec2 } from "../geom";
import { degToRad } from "../model/units";
import { attachmentsAt, linkPointNear } from "../canvas/attach";
import type { SnapResult } from "../canvas/snapping";
import { indexDocument, type Id } from "../model";
import type { ToolContext } from "./types";

export interface SliderAim {
  /** The anchor (world): the block's position. */
  at: Vec2;
  /** The link the anchor belongs to; never offered as the rail. */
  anchorLinkId?: Id;
  axisAngle: number;
  /** The moving link the block will slide along; absent: ground. */
  railLinkId?: Id;
  /** The rail's display name, for the hint. */
  railName?: string;
}

/**
 * The moving link under `world` the block could slide along (never the
 * anchor's own link, never ground) and, over a bar, that bar's direction
 * there, oriented toward the cursor.
 */
export function railAt(
  aim: SliderAim,
  world: Vec2,
  ctx: ToolContext,
): { linkId: Id; name: string; angle?: number } | undefined {
  const index = indexDocument(ctx.doc);
  for (const candidate of attachmentsAt(ctx.doc, world, ctx.radiusWorld)) {
    if (candidate.linkId === aim.anchorLinkId) continue;
    const link = index.links.get(candidate.linkId);
    if (!link || link.isGround) continue;
    const near = linkPointNear(link, world, ctx.radiusWorld);
    let angle: number | undefined;
    if (near?.segment) {
      const seg = sub(near.segment[1], near.segment[0]);
      if (magnitude(seg) > 1e-9) {
        angle = direction(seg);
        const rel = sub(world, aim.at);
        if (magnitude(rel) > 1e-9 && dot(rel, fromPolar(1, angle)) < 0) angle += Math.PI;
      }
    }
    return { linkId: link.id, name: link.name || link.id, angle };
  }
  return undefined;
}

/** `aim` with the rail and axis the pointer at `world` implies. */
export function aimAt<S extends SliderAim>(
  aim: S,
  world: Vec2,
  snap: SnapResult,
  ctx: ToolContext,
): S {
  const rail = railAt(aim, world, ctx);
  const rel = sub(world, aim.at);
  let axisAngle = aim.axisAngle;
  if (rail?.angle !== undefined) {
    axisAngle = rail.angle;
  } else if (snap.kind === "angle" && snap.angleDeg !== undefined) {
    axisAngle = degToRad(snap.angleDeg);
  } else if (magnitude(rel) > 1e-9) {
    axisAngle = direction(rel);
  }
  return { ...aim, axisAngle, railLinkId: rail?.linkId, railName: rail?.name };
}
