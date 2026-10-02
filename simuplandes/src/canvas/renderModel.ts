/**
 * `buildRenderModel(doc, selection, options?)`: a pure document -> WORLD
 * -space render-primitive model. Konva layers only need to map every point
 * through `worldToScreen` -- this module never touches Konva/React.
 *
 * `options.poses` is the Phase 5 seam: an override map of link id -> Pose,
 * used instead of `link.pose` when present. Phase 4 always leaves it
 * undefined (Build mode renders the document's own reference poses); Phase
 * 5 can feed solved poses through this same function without any other
 * change here, and `src/canvas` never imports `src/kinematics` (enforced by
 * the seam ESLint rule).
 */

import { rotate, type Vec2 } from "../geom";
import {
  indexDocument,
  siteWorldPosition,
  type Id,
  type Link,
  type MechanismDocument,
  type Pose,
} from "../model";
import { LINK_TYPE_COLORS } from "../ui/theme/tokens";
import { linkTypes } from "./linkType";

export interface BarPrimitive {
  linkId: Id;
  /** World-space points, in site order. A single-site bar is a single point. */
  points: Vec2[];
  color: string;
  selected: boolean;
  /** `true` when `options.hoverId` names this link (GRF-02). */
  hovered: boolean;
  /** `true` when this link is in `options.issueLinkIds` (GRF-03, the Baranov overlay). */
  issue: boolean;
}

export interface PlatePrimitive {
  linkId: Id;
  /** World-space polygon (closed implicitly -- last point connects back to the first). */
  points: Vec2[];
  color: string;
  selected: boolean;
  /** `true` when `options.hoverId` names this link (GRF-02). */
  hovered: boolean;
  /** `true` when this link is in `options.issueLinkIds` (GRF-03, the Baranov overlay). */
  issue: boolean;
}

export interface GroundPivotPrimitive {
  linkId: Id;
  siteId: Id;
  point: Vec2;
  /** `true` when `options.hoverId` names this pivot's ground LINK (GRF-02). */
  hovered: boolean;
  /** `true` when this pivot's ground link is in `options.issueLinkIds` (GRF-03). */
  issue: boolean;
}

export interface PinPrimitive {
  jointId: Id;
  point: Vec2;
  /** `true` when the joint's two sites coincide in world space within 1e-9. */
  coincident: boolean;
  /** `true` when this joint's id is in `selection` (GRF-02, graph-edge selection visible on canvas). */
  selected: boolean;
  /** `true` when `options.hoverId` names this joint (GRF-02). */
  hovered: boolean;
}

export interface SliderPrimitive {
  jointId: Id;
  point: Vec2;
  /** Unit slide-axis direction in WORLD space. */
  axisWorld: Vec2;
  /** The rail/block's world-space orientation (radians), for `angleToKonvaRotationDeg`. */
  blockAngle: number;
  /** `true` when this joint's id is in `selection` (GRF-02, graph-edge selection visible on canvas). */
  selected: boolean;
  /** `true` when `options.hoverId` names this joint (GRF-02). */
  hovered: boolean;
}

export interface MotorPrimitive {
  jointId: Id;
  point: Vec2;
  kind: "rotary" | "linear";
}

export interface MarkerPrimitive {
  markerId: Id;
  point: Vec2;
}

export interface FreeSitePrimitive {
  siteId: Id;
  linkId: Id;
  point: Vec2;
}

export interface RenderModel {
  bars: BarPrimitive[];
  plates: PlatePrimitive[];
  groundPivots: GroundPivotPrimitive[];
  pins: PinPrimitive[];
  sliders: SliderPrimitive[];
  motors: MotorPrimitive[];
  markers: MarkerPrimitive[];
  freeSites: FreeSitePrimitive[];
}

export interface BuildRenderModelOptions {
  /** Per-link pose override -- the Phase 5 seam. Undefined in Phase 4. */
  poses?: ReadonlyMap<Id, Pose>;
  /** GRF-02: the shared hover id (a link id or a joint id), or `null`/undefined for "nothing hovered". */
  hoverId?: Id | null;
  /** GRF-03: link ids flagged by the Baranov rigid-subchain check, drawn with an issue outline. */
  issueLinkIds?: ReadonlySet<Id>;
}

/** Builds the WORLD-space render primitives for `doc`, given the current `selection`. */
export function buildRenderModel(
  doc: MechanismDocument,
  selection: ReadonlySet<Id>,
  options?: BuildRenderModelOptions,
): RenderModel {
  const index = indexDocument(doc);
  const types = linkTypes(doc);

  function poseOf(link: Link): Pose {
    return options?.poses?.get(link.id) ?? link.pose;
  }
  function worldOf(link: Link, local: readonly [number, number]): Vec2 {
    return siteWorldPosition({ pose: poseOf(link) }, local);
  }

  const bars: BarPrimitive[] = [];
  const plates: PlatePrimitive[] = [];
  const groundPivots: GroundPivotPrimitive[] = [];
  const freeSites: FreeSitePrimitive[] = [];

  const jointCountBySite = new Map<Id, number>();
  for (const joint of doc.joints) {
    jointCountBySite.set(joint.siteA, (jointCountBySite.get(joint.siteA) ?? 0) + 1);
    jointCountBySite.set(joint.siteB, (jointCountBySite.get(joint.siteB) ?? 0) + 1);
  }

  for (const link of doc.links) {
    // `types` is built by `linkTypes(doc)` over this same `doc.links`, so
    // every link id is always present -- no defensive fallback needed.
    const type = types.get(link.id)!;
    const color = link.color ?? LINK_TYPE_COLORS[type];
    const selected = selection.has(link.id);
    const hovered = options?.hoverId === link.id;
    const issue = options?.issueLinkIds?.has(link.id) ?? false;
    const points = link.sites.map((site) => worldOf(link, site.local));

    if (link.shape.kind === "bar") {
      bars.push({ linkId: link.id, points, color, selected, hovered, issue });
    } else {
      const outlinePoints = link.shape.outline.map((v) => worldOf(link, v));
      plates.push({ linkId: link.id, points: outlinePoints, color, selected, hovered, issue });
    }

    if (link.isGround) {
      for (const site of link.sites) {
        groundPivots.push({
          linkId: link.id,
          siteId: site.id,
          point: worldOf(link, site.local),
          hovered,
          issue,
        });
      }
    }

    for (const site of link.sites) {
      if (!jointCountBySite.get(site.id)) {
        freeSites.push({ siteId: site.id, linkId: link.id, point: worldOf(link, site.local) });
      }
    }
  }

  // Every joint/motor/marker reference below is guaranteed to resolve by
  // `MechanismDocumentSchema`'s referential-integrity check
  // (`checkDocumentIntegrity`), which every `MechanismDocument` value has
  // already passed -- so lookups use a non-null assertion rather than a
  // defensive branch that a schema-valid document can never take.
  const pins: PinPrimitive[] = [];
  const sliders: SliderPrimitive[] = [];

  for (const joint of doc.joints) {
    const entryA = index.sites.get(joint.siteA)!;
    const entryB = index.sites.get(joint.siteB)!;
    const pointA = worldOf(entryA.link, entryA.site.local);
    const pointB = worldOf(entryB.link, entryB.site.local);

    const jointSelected = selection.has(joint.id);
    const jointHovered = options?.hoverId === joint.id;

    if (joint.type === "R") {
      const coincident = Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) <= 1e-9;
      const point = { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 };
      pins.push({
        jointId: joint.id,
        point,
        coincident,
        selected: jointSelected,
        hovered: jointHovered,
      });
    } else {
      const angleA = poseOf(entryA.link).angle;
      const axisWorld = rotate({ x: joint.axis[0], y: joint.axis[1] }, angleA);
      const blockAngle = Math.atan2(axisWorld.y, axisWorld.x);
      sliders.push({
        jointId: joint.id,
        point: pointA,
        axisWorld,
        blockAngle,
        selected: jointSelected,
        hovered: jointHovered,
      });
    }
  }

  const motors: MotorPrimitive[] = [];
  for (const motor of doc.motors) {
    const joint = index.joints.get(motor.jointId)!;
    const entryA = index.sites.get(joint.siteA)!;
    motors.push({
      jointId: joint.id,
      point: worldOf(entryA.link, entryA.site.local),
      kind: motor.kind,
    });
  }

  const markers: MarkerPrimitive[] = [];
  for (const marker of doc.markers) {
    const link = index.links.get(marker.linkId)!;
    markers.push({ markerId: marker.id, point: worldOf(link, marker.local) });
  }

  return { bars, plates, groundPivots, pins, sliders, motors, markers, freeSites };
}
