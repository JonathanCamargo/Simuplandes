/**
 * Pure helpers over a `MechanismDocument`: construction, indexing, and
 * link-local <-> world coordinate conversions. No store, no side effects.
 */

import { localToWorld, worldToLocal, direction, sub, type Vec2 } from "../geom";
import { cleanNumber, toTuple, type Vec2Tuple } from "./vec";
import { CURRENT_SCHEMA_VERSION, MechanismDocumentSchema } from "./schema";
import { DEFAULT_LENGTH_UNIT } from "./units";
import type { MechanismDocument, Link, Site, Joint, Motor, Marker, Load, Pose } from "./schema";
import type { LengthUnit } from "./units";
import type { Id } from "./ids";

/** Creates a new, empty mechanism document. */
export function createEmptyDocument(options?: {
  name?: string;
  lengthUnit?: LengthUnit;
}): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...(options?.name !== undefined ? { name: options.name } : {}),
    units: { length: options?.lengthUnit ?? DEFAULT_LENGTH_UNIT },
  });
}

/** A fast id -> entity index over a document, built once and read many times. */
export interface DocumentIndex {
  links: Map<Id, Link>;
  sites: Map<Id, { site: Site; link: Link }>;
  joints: Map<Id, Joint>;
  motors: Map<Id, Motor>;
  markers: Map<Id, Marker>;
  loads: Map<Id, Load>;
  jointsBySite: Map<Id, Joint[]>;
}

/** Builds a `DocumentIndex` over a document's entities. */
export function indexDocument(doc: MechanismDocument): DocumentIndex {
  const links = new Map<Id, Link>();
  const sites = new Map<Id, { site: Site; link: Link }>();
  for (const link of doc.links) {
    links.set(link.id, link);
    for (const site of link.sites) {
      sites.set(site.id, { site, link });
    }
  }

  const joints = new Map<Id, Joint>();
  const jointsBySite = new Map<Id, Joint[]>();
  const addJointForSite = (siteId: Id, joint: Joint): void => {
    const existing = jointsBySite.get(siteId);
    if (existing) {
      existing.push(joint);
    } else {
      jointsBySite.set(siteId, [joint]);
    }
  };
  for (const joint of doc.joints) {
    joints.set(joint.id, joint);
    addJointForSite(joint.siteA, joint);
    addJointForSite(joint.siteB, joint);
  }

  const motors = new Map<Id, Motor>();
  for (const motor of doc.motors) motors.set(motor.id, motor);

  const markers = new Map<Id, Marker>();
  for (const marker of doc.markers) markers.set(marker.id, marker);

  const loads = new Map<Id, Load>();
  for (const load of doc.loads) loads.set(load.id, load);

  return { links, sites, joints, motors, markers, loads, jointsBySite };
}

/** Collects every entity id in a document (links, sites, joints, motors, markers, loads). */
export function collectIds(doc: MechanismDocument): Set<Id> {
  const ids = new Set<Id>();
  for (const link of doc.links) {
    ids.add(link.id);
    for (const site of link.sites) ids.add(site.id);
  }
  for (const joint of doc.joints) ids.add(joint.id);
  for (const motor of doc.motors) ids.add(motor.id);
  for (const marker of doc.markers) ids.add(marker.id);
  for (const load of doc.loads) ids.add(load.id);
  return ids;
}

/** Converts a site's link-local coordinate to world, via its link's reference pose. */
export function siteWorldPosition(
  link: Pick<Link, "pose">,
  local: readonly [number, number],
): Vec2 {
  const [x, y] = link.pose.position;
  return localToWorld({ x: local[0], y: local[1] }, { x, y }, link.pose.angle);
}

/** Builds a reference pose whose x-axis points from world point `a` toward world point `b`. */
export function poseFromWorldPoints(a: Vec2, b: Vec2): Pose {
  const angle = cleanNumber(direction(sub(b, a)));
  return { position: toTuple(a), angle };
}

/** Converts a world point into a link's local frame, given the link's reference pose. */
export function worldToLinkLocal(pose: Pose, p: Vec2): Vec2Tuple {
  const [ox, oy] = pose.position;
  const local = worldToLocal(p, { x: ox, y: oy }, pose.angle);
  return toTuple(local);
}

/**
 * Sites transitively connected to `siteId` by R (revolute) joints only --
 * the set of sites that must move together to keep the drawing connected.
 * P joints do NOT join a cluster (their two sites slide apart by design).
 * A site with no R joints (or an id not present in the document) maps to
 * the singleton `{siteId}`. Shared with 04-05's joint-drag tool.
 */
export function jointClusterSiteIds(doc: MechanismDocument, siteId: Id): Set<Id> {
  const { jointsBySite } = indexDocument(doc);
  const cluster = new Set<Id>([siteId]);
  const queue: Id[] = [siteId];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    for (const joint of jointsBySite.get(current) ?? []) {
      if (joint.type !== "R") continue;
      const other = joint.siteA === current ? joint.siteB : joint.siteA;
      if (!cluster.has(other)) {
        cluster.add(other);
        queue.push(other);
      }
    }
  }

  return cluster;
}

/** Serializes a document to pretty JSON (2-space indent, trailing newline). */
export function serializeDocument(doc: MechanismDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
