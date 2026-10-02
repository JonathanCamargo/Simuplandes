/**
 * Pure layout seeds (09-02). Deterministic (seeded PRNG, never `Math.random`)
 * starting positions for topology-only graphs: nodes on a circle, each joint
 * at the midpoint of its two link anchors, plus Gaussian jitter for the
 * multi-start, and a cheap degeneracy filter. Kinematics-free: the mobility
 * gate that accepts or rejects a seed lives in `src/sim/autoLayout.ts`.
 *
 * `positions[i]` is the joint position of `req.edges[i]` (the 09-01 contract).
 */

import type { LayoutRequest, Vec2Tuple } from "./importReport";

/** Anchor circle radius (model units). */
export const SEED_RADIUS = 100;
/** Jitter sigma as a fraction of the radius. */
export const JITTER_SIGMA_FRACTION = 0.25;
/** Two joints of one link closer than this fraction of the radius are degenerate. */
export const MIN_JOINT_SEPARATION_FRACTION = 0.05;
/** A >= 3-joint link whose widest triangle is below this fraction of radius^2 is collinear. */
export const MIN_TRIANGLE_AREA_FRACTION = 0.02;

const VARIANT_MIX = 0x9e3779b1;
const TRY_MIX = 0x85ebca6b;

/** mulberry32: deterministic PRNG yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of node count + the sorted normalized edge list + kinds (edge order does not matter). */
export function hashLayoutGraph(req: Pick<LayoutRequest, "nodeCount" | "edges">): number {
  const tokens = req.edges
    .map((e) => `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}${e.kind}`)
    .sort();
  const text = `${req.nodeCount}|${tokens.join(",")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function anchor(k: number, n: number, radius: number): Vec2Tuple {
  const angle = (2 * Math.PI * k) / Math.max(1, n);
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** Node k on a circle; each joint at the midpoint of its two anchors (a P joint is one point too). */
export function circleMidpointSeed(req: LayoutRequest, radius: number = SEED_RADIUS): Vec2Tuple[] {
  return req.edges.map((e) => {
    const a = anchor(e.u, req.nodeCount, radius);
    const b = anchor(e.v, req.nodeCount, radius);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  });
}

function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Try `tryIndex` of `variant`: the plain circle seed for (0, 0), otherwise
 * the circle seed with Gaussian jitter (sigma = 0.25 x radius). Identical
 * arguments give identical positions.
 */
export function jitteredSeed(req: LayoutRequest, variant: number, tryIndex: number): Vec2Tuple[] {
  const base = circleMidpointSeed(req);
  if (variant === 0 && tryIndex === 0) return base;
  const seed =
    (hashLayoutGraph(req) ^ Math.imul(variant, VARIANT_MIX) ^ Math.imul(tryIndex, TRY_MIX)) >>> 0;
  const rand = mulberry32(seed);
  const sigma = JITTER_SIGMA_FRACTION * SEED_RADIUS;
  return base.map((p) => {
    const dx = sigma * gaussian(rand);
    const dy = sigma * gaussian(rand);
    return [p[0] + dx, p[1] + dy] as const;
  });
}

function triangleArea(a: Vec2Tuple, b: Vec2Tuple, c: Vec2Tuple): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

/**
 * True when two joints of one link are closer than 0.05 x radius, or a link
 * with >= 3 joints is near-collinear (its widest triangle is tiny).
 */
export function isDegenerateSeed(req: LayoutRequest, positions: readonly Vec2Tuple[]): boolean {
  const joints: Vec2Tuple[][] = Array.from({ length: req.nodeCount }, () => []);
  req.edges.forEach((e, i) => {
    joints[e.u]?.push(positions[i]);
    joints[e.v]?.push(positions[i]);
  });
  const minSep = MIN_JOINT_SEPARATION_FRACTION * SEED_RADIUS;
  const minArea = MIN_TRIANGLE_AREA_FRACTION * SEED_RADIUS * SEED_RADIUS;
  for (const pts of joints) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < minSep) return true;
      }
    }
    if (pts.length >= 3) {
      let widest = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          for (let k = j + 1; k < pts.length; k++) {
            widest = Math.max(widest, triangleArea(pts[i], pts[j], pts[k]));
          }
        }
      }
      if (widest < minArea) return true;
    }
  }
  return false;
}
