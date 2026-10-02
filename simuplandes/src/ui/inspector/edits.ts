/**
 * Pure selection -> Inspector-target resolution, plus pure value -> recipe
 * builders for every Inspector form. No React; imported by the forms.
 *
 * Moving a link's pose (`linkPoseRecipe`) moves its sites in world space by
 * changing the pose only -- it is allowed to disassemble joints, matching
 * the existing `moveEntities` semantics. Joint and site coordinate edits go
 * through `moveSiteClusterRecipes` instead, so connected sites stay
 * connected.
 */

import {
  add,
  direction,
  distance,
  fromPolar,
  normalize,
  rotate,
  scale,
  sub,
  type Vec2,
} from "../../geom";
import {
  indexDocument,
  jointClusterSiteIds,
  siteWorldPosition,
  worldToLinkLocal,
  degToRad,
  radToDeg,
  toVec2,
  toTuple,
  type Id,
  type Link,
  type Joint,
  type PrismaticJoint,
  type Motor,
  type Marker,
  type Site,
  type MechanismDocument,
} from "../../model";
import {
  CommandError,
  setJointAxis,
  setMarkerLocal,
  setLinkPose,
  setSiteLocal,
  type Recipe,
} from "../../store/commands";

export type InspectorTarget =
  | { kind: "document" }
  | { kind: "multi"; count: number }
  | { kind: "link"; link: Link }
  | { kind: "joint"; joint: Joint }
  | { kind: "site"; site: Site; link: Link }
  | { kind: "motor"; motor: Motor }
  | { kind: "marker"; marker: Marker };

/**
 * Resolves the current selection to what the Inspector should show: the
 * document (empty selection), a multi-selection count (2+ ids), or the one
 * selected entity -- a site belonging to a joint resolves to that joint
 * (via `jointsBySite`), so clicking a pin's site shows the joint form.
 */
export function resolveInspectorTarget(
  doc: MechanismDocument,
  selection: ReadonlySet<Id>,
): InspectorTarget {
  if (selection.size === 0) return { kind: "document" };
  if (selection.size >= 2) return { kind: "multi", count: selection.size };

  const [id] = selection;
  const index = indexDocument(doc);

  const link = index.links.get(id);
  if (link) return { kind: "link", link };

  const joint = index.joints.get(id);
  if (joint) return { kind: "joint", joint };

  const siteEntry = index.sites.get(id);
  if (siteEntry) {
    const joints = index.jointsBySite.get(id);
    if (joints && joints.length > 0) {
      return { kind: "joint", joint: joints[0] };
    }
    return { kind: "site", site: siteEntry.site, link: siteEntry.link };
  }

  const motor = index.motors.get(id);
  if (motor) return { kind: "motor", motor };

  const marker = index.markers.get(id);
  if (marker) return { kind: "marker", marker };

  return { kind: "document" };
}

/** The distance between a link's two sites, or `null` unless it has exactly two. */
export function barLength(link: Link): number | null {
  if (link.sites.length !== 2) return null;
  const [a, b] = link.sites;
  return distance(toVec2(a.local), toVec2(b.local));
}

/**
 * Keeps `link`'s first site fixed and moves the second along its current
 * direction so the bar's length becomes exactly `length`, cascading the
 * move to every R-cluster partner of the second site (so the drawing stays
 * connected). Throws `CommandError` for a non-positive length or a link
 * that is not a two-site bar.
 */
export function setBarLengthRecipes(doc: MechanismDocument, link: Link, length: number): Recipe[] {
  if (!(length > 0)) {
    throw new CommandError("length must be positive");
  }
  if (link.sites.length !== 2) {
    throw new CommandError(`link "${link.id}" does not have exactly two sites`);
  }
  const [siteA, siteB] = link.sites;
  const a = toVec2(siteA.local);
  const b = toVec2(siteB.local);
  const dir = normalize(sub(b, a));
  const newLocalB = add(a, scale(dir, length));
  const newWorld = siteWorldPosition(link, toTuple(newLocalB));
  return moveSiteClusterRecipes(doc, siteB.id, newWorld);
}

/**
 * Moves every site transitively R-joined to `siteId` (its whole cluster,
 * including itself) so each ends up at the world point `world`, converting
 * through each site's own link pose.
 */
export function moveSiteClusterRecipes(doc: MechanismDocument, siteId: Id, world: Vec2): Recipe[] {
  const cluster = jointClusterSiteIds(doc, siteId);
  const index = indexDocument(doc);
  const recipes: Recipe[] = [];
  for (const id of cluster) {
    const entry = index.sites.get(id);
    if (!entry) continue;
    recipes.push(setSiteLocal(id, worldToLinkLocal(entry.link.pose, world)));
  }
  return recipes;
}

/** Builds a `setLinkPose` recipe from a partial edit (only the given fields change). */
export function linkPoseRecipe(
  link: Link,
  edit: { x?: number; y?: number; angleDeg?: number },
): Recipe {
  const position: [number, number] = [
    edit.x ?? link.pose.position[0],
    edit.y ?? link.pose.position[1],
  ];
  const angle = edit.angleDeg !== undefined ? degToRad(edit.angleDeg) : link.pose.angle;
  return setLinkPose(link.id, { position, angle });
}

/** The world position of a joint's `siteA`. */
export function jointWorldPosition(doc: MechanismDocument, joint: Joint): Vec2 {
  const entry = indexDocument(doc).sites.get(joint.siteA);
  if (!entry) throw new CommandError(`unknown site "${joint.siteA}"`);
  return siteWorldPosition(entry.link, entry.site.local);
}

/** A prismatic joint's slide axis, rotated into world space by `siteA`'s link pose, in degrees. */
export function jointAxisWorldAngleDeg(doc: MechanismDocument, joint: PrismaticJoint): number {
  const entry = indexDocument(doc).sites.get(joint.siteA);
  if (!entry) throw new CommandError(`unknown site "${joint.siteA}"`);
  const worldAxis = rotate(toVec2(joint.axis), entry.link.pose.angle);
  return radToDeg(direction(worldAxis));
}

/** Builds a `setJointAxis` recipe from a world-space angle (degrees), as a unit axis in `siteA`-local. */
export function setJointAxisFromWorldAngleRecipe(
  doc: MechanismDocument,
  joint: PrismaticJoint,
  angleDeg: number,
): Recipe {
  const entry = indexDocument(doc).sites.get(joint.siteA);
  if (!entry) throw new CommandError(`unknown site "${joint.siteA}"`);
  const worldAxis = fromPolar(1, degToRad(angleDeg));
  const localAxis = rotate(worldAxis, -entry.link.pose.angle);
  return setJointAxis(joint.id, toTuple(localAxis));
}

/** Builds the recipe(s) to move `marker` to the world point `world`. */
export function markerWorldRecipes(doc: MechanismDocument, marker: Marker, world: Vec2): Recipe[] {
  const link = indexDocument(doc).links.get(marker.linkId);
  if (!link) throw new CommandError(`unknown link "${marker.linkId}"`);
  return [setMarkerLocal(marker.id, worldToLinkLocal(link.pose, world))];
}

/** Converts a stored motor speed (rad/s for rotary, length-units/s for linear) to its display unit. */
export function motorSpeedDisplay(kind: "rotary" | "linear", speed: number): number {
  return kind === "rotary" ? radToDeg(speed) : speed;
}

/** Inverse of `motorSpeedDisplay`: converts a display-unit value back to the stored speed. */
export function motorSpeedFromDisplay(kind: "rotary" | "linear", value: number): number {
  return kind === "rotary" ? degToRad(value) : value;
}
