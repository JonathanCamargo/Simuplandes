/**
 * Local <-> world frame transforms for a rigid body at a given origin and
 * rotation. Angles are radians, counter-clockwise positive.
 */

import { add, sub, rotate, type Vec2 } from "./vec2";

/** Transforms a point from a body's local frame into world coordinates. */
export function localToWorld(local: Vec2, origin: Vec2, angle: number): Vec2 {
  return add(rotate(local, angle), origin);
}

/** Transforms a point from world coordinates into a body's local frame. */
export function worldToLocal(world: Vec2, origin: Vec2, angle: number): Vec2 {
  return rotate(sub(world, origin), -angle);
}
