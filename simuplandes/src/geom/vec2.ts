/**
 * Pure 2D vector math. All angles are radians, counter-clockwise positive,
 * in a y-up frame (standard `Math.cos`/`Math.sin` convention). No mutation,
 * no classes, no dependencies.
 */

/** A plain 2D vector / point. Always treated as immutable. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The zero vector. Frozen — never mutate; build a new vector instead. */
export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

/** Builds a Vec2 from components. */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/** Vector addition: a + b. */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Vector subtraction: a - b. */
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Scalar multiplication: v * s. */
export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

/** Negation: -v. */
export function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

/** Dot product: a . b. */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Z component of the 2D cross product (a x b) = a.x*b.y - a.y*b.x. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Rotates v by +90 degrees (CCW): (x,y) -> (-y,x). */
export function perp(v: Vec2): Vec2 {
  // `0 + -v.y` (rather than `-v.y`) avoids producing -0 when v.y is 0,
  // per IEEE 754 addition rules (+0 + -0 = +0), without adding a branch.
  return { x: 0 + -v.y, y: v.x };
}

/** Euclidean length of v. */
export function magnitude(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Euclidean distance between a and b. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector in the direction of v. Zero vector maps to ZERO (never NaN). */
export function normalize(v: Vec2): Vec2 {
  const m = magnitude(v);
  if (m === 0) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / m, y: v.y / m };
}

/** Angle of v in radians, in (-pi, pi]. Zero vector maps to 0. */
export function direction(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/** Builds a vector from magnitude and angle (radians). */
export function fromPolar(mag: number, angle: number): Vec2 {
  return { x: mag * Math.cos(angle), y: mag * Math.sin(angle) };
}

/** Rotates v counter-clockwise by angle (radians). */
export function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
