/**
 * Test-only document builders for `src/interchange`'s own tests (coverage-
 * excluded via `vite.config.ts`'s `src/**\/__fixtures__/**` glob). A small,
 * local re-implementation of `src/kinematics/__fixtures__/build.ts`'s
 * `defineLink`/`makeDocument` — `src/interchange` may not import
 * `src/kinematics` (ESLint seam), so this file, like
 * `src/graph/__fixtures__/fromEdges.ts`, builds `MechanismDocument`s
 * directly through `src/model`'s pure helpers instead of reaching across
 * the seam.
 */

import { vec2, type Vec2 } from "../../geom";
import {
  createId,
  worldToLinkLocal,
  MechanismDocumentSchema,
  type Link,
  type LinkShape,
  type MechanismDocument,
  type MechanismDocumentInput,
  type Pose,
  type Site,
} from "../../model";

export interface BuildLinkInput {
  readonly id?: string;
  readonly name: string;
  readonly isGround?: boolean;
  readonly angle?: number;
  readonly origin: readonly [number, number];
  readonly sites: Readonly<Record<string, readonly [number, number]>>;
}

export interface BuiltLink {
  readonly link: Link;
  readonly siteIds: Readonly<Record<string, string>>;
}

/** Builds a `Link` from a reference pose and named WORLD-space site points. */
export function buildLink(input: BuildLinkInput): BuiltLink {
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

/** Parses/validates a test document through the real schema. */
export function makeDoc(input: MechanismDocumentInput): MechanismDocument {
  return MechanismDocumentSchema.parse(input);
}

/** World point helper, matching `src/kinematics/__fixtures__/build.ts`'s call shape. */
export function pt(x: number, y: number): Vec2 {
  return vec2(x, y);
}
