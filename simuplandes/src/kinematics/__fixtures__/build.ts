/**
 * Test-only fixture-building helpers (coverage-excluded via
 * `vite.config.ts`'s `__fixtures__` exclusion). Builds `MechanismDocument`s
 * directly through `src/model`'s pure helpers — no store, no React —
 * exactly like `src/store/examples.ts`'s `buildExampleFourBar` needs no UI.
 */

import { type Vec2, vec2 } from "../../geom";
import {
  createId,
  worldToLinkLocal,
  MechanismDocumentSchema,
  type MechanismDocument,
  type MechanismDocumentInput,
  type Link,
  type LinkShape,
  type Pose,
  type Site,
} from "../../model";

/** Input to `defineLink`: a reference pose (origin/angle) and named sites given as WORLD points. */
export interface DefineLinkInput {
  readonly id?: string;
  readonly name: string;
  readonly isGround?: boolean;
  readonly angle?: number;
  readonly origin: readonly [number, number];
  readonly sites: Readonly<Record<string, readonly [number, number]>>;
}

/** The built `Link`, plus a lookup from the caller's site keys to the generated site ids. */
export interface DefinedLink {
  readonly link: Link;
  readonly siteIds: Readonly<Record<string, string>>;
}

/**
 * Builds a `Link` from a reference pose and named WORLD-space site points,
 * converting each to link-local coordinates. Plates (shape kind "plate")
 * are used when there are 3+ sites (the site locals become the outline);
 * otherwise the link is a bar.
 */
export function defineLink(input: DefineLinkInput): DefinedLink {
  const pose: Pose = { position: [input.origin[0], input.origin[1]], angle: input.angle ?? 0 };
  const siteIds: Record<string, string> = {};
  const sites: Site[] = Object.entries(input.sites).map(([key, worldPoint]) => {
    const id = createId("site");
    siteIds[key] = id;
    const local = worldToLinkLocal(pose, vec2(worldPoint[0], worldPoint[1]));
    return { id, name: key, local };
  });

  const shape: LinkShape =
    sites.length >= 3 ? { kind: "plate", outline: sites.map((s) => s.local) } : { kind: "bar" };

  const link: Link = {
    id: input.id ?? createId("link"),
    name: input.name,
    isGround: input.isGround ?? false,
    pose,
    shape,
    sites,
  };

  return { link, siteIds };
}

/**
 * The intersection of two circles, choosing the point to the left (+1) or
 * right (-1) of the direction from `c1` to `c2`. Throws if the circles do
 * not intersect.
 */
export function circleIntersection(c1: Vec2, r1: number, c2: Vec2, r2: number, sign: 1 | -1): Vec2 {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) {
    throw new Error(`circleIntersection: circles do not intersect (d=${d}, r1=${r1}, r2=${r2})`);
  }
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(hSq, 0));
  const midX = c1.x + (a * dx) / d;
  const midY = c1.y + (a * dy) / d;
  const perpX = -dy / d;
  const perpY = dx / d;
  return { x: midX + sign * h * perpX, y: midY + sign * h * perpY };
}

/** Parses/validates a fixture input through the real schema, so every fixture is schema-valid. */
export function makeDocument(input: MechanismDocumentInput): MechanismDocument {
  return MechanismDocumentSchema.parse(input);
}
