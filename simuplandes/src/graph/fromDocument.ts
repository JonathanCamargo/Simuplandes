/**
 * `MechanismDocument` -> ground-merged `LinkGraph` (GRF-01/GRF-03's shared
 * merge convention). Pure, framework-free, and never imports
 * `src/kinematics` (ESLint seam) -- reuses `src/canvas/linkType.ts`'s
 * `linkTypes` as the ONE link-type classifier (canvas coloring and the
 * graph panel must always agree) and `src/model`'s `indexDocument`/
 * `siteWorldPosition` for site resolution and reference-pose world
 * coordinates. Never reads `simStore`: the graph is always the Build-mode
 * reference-pose topology (research Pitfall 3), and this function never
 * mutates `doc`.
 */

import {
  indexDocument,
  siteWorldPosition,
  type Id,
  type Link,
  type MechanismDocument,
} from "../model";
import type { Vec2 } from "../geom";
import { linkTypes } from "../canvas/linkType";
import {
  GROUND_NODE_ID,
  type GraphEdge,
  type GraphNode,
  type GraphWarning,
  type LinkGraph,
} from "./types";

function meanOf(points: readonly Vec2[]): Vec2 | null {
  if (points.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function movingCentroid(link: Link): Vec2 {
  const points = link.sites.map((site) => siteWorldPosition(link, site.local));
  return meanOf(points) ?? { x: link.pose.position[0], y: link.pose.position[1] };
}

/**
 * Ground centroid: mean world position of ground sites that belong to a
 * joint (any doc joint's siteA/siteB resolving to a ground link), falling
 * back to all ground sites, then to the first ground link's pose position.
 */
function groundCentroid(
  groundLinks: readonly Link[],
  doc: MechanismDocument,
  index: ReturnType<typeof indexDocument>,
): Vec2 {
  const groundLinkIds = new Set(groundLinks.map((l) => l.id));
  const jointedSiteIds = new Set<Id>();
  for (const joint of doc.joints) {
    for (const siteId of [joint.siteA, joint.siteB]) {
      const info = index.sites.get(siteId);
      if (info && groundLinkIds.has(info.link.id)) jointedSiteIds.add(siteId);
    }
  }

  const jointedPoints: Vec2[] = [];
  for (const siteId of jointedSiteIds) {
    const info = index.sites.get(siteId);
    if (info) jointedPoints.push(siteWorldPosition(info.link, info.site.local));
  }
  const jointedMean = meanOf(jointedPoints);
  if (jointedMean) return jointedMean;

  const allGroundPoints: Vec2[] = [];
  for (const link of groundLinks) {
    for (const site of link.sites) {
      allGroundPoints.push(siteWorldPosition(link, site.local));
    }
  }
  const allMean = meanOf(allGroundPoints);
  if (allMean) return allMean;

  const first = groundLinks[0];
  return { x: first.pose.position[0], y: first.pose.position[1] };
}

/** Builds the ground-merged `LinkGraph` for `doc`. Pure; never mutates `doc`. */
export function fromDocument(doc: MechanismDocument): LinkGraph {
  const index = indexDocument(doc);
  const types = linkTypes(doc);

  const groundLinks = doc.links.filter((l) => l.isGround);
  const movingLinks = doc.links.filter((l) => !l.isGround);

  const nodeIdOfLink = new Map<Id, Id>();
  for (const link of groundLinks) nodeIdOfLink.set(link.id, GROUND_NODE_ID);
  for (const link of movingLinks) nodeIdOfLink.set(link.id, link.id);

  const edges: GraphEdge[] = [];
  const warnings: GraphWarning[] = [];
  const degreeById = new Map<Id, number>();
  const bumpDegree = (id: Id): void => {
    degreeById.set(id, (degreeById.get(id) ?? 0) + 1);
  };

  for (const joint of doc.joints) {
    const siteA = index.sites.get(joint.siteA);
    const siteB = index.sites.get(joint.siteB);
    if (!siteA || !siteB) {
      warnings.push({ kind: "danglingJoint", jointId: joint.id });
      continue;
    }
    const nodeA = nodeIdOfLink.get(siteA.link.id);
    const nodeB = nodeIdOfLink.get(siteB.link.id);
    if (nodeA === undefined || nodeB === undefined) {
      warnings.push({ kind: "danglingJoint", jointId: joint.id });
      continue;
    }
    if (nodeA === GROUND_NODE_ID && nodeB === GROUND_NODE_ID) {
      warnings.push({ kind: "groundLoop", jointId: joint.id });
      continue;
    }
    edges.push({
      id: joint.id,
      jointId: joint.id,
      type: joint.type,
      a: nodeA,
      b: nodeB,
      groundPivot: nodeA === GROUND_NODE_ID || nodeB === GROUND_NODE_ID,
    });
    bumpDegree(nodeA);
    bumpDegree(nodeB);
  }

  const nodes: GraphNode[] = [];
  const nodeById = new Map<Id, GraphNode>();

  if (groundLinks.length > 0) {
    const groundNode: GraphNode = {
      id: GROUND_NODE_ID,
      linkIds: groundLinks.map((l) => l.id),
      isGround: true,
      linkType: "ground",
      degree: degreeById.get(GROUND_NODE_ID) ?? 0,
      label: "",
      centroid: groundCentroid(groundLinks, doc, index),
    };
    nodes.push(groundNode);
    nodeById.set(GROUND_NODE_ID, groundNode);
  }

  for (const link of movingLinks) {
    const node: GraphNode = {
      id: link.id,
      linkIds: [link.id],
      isGround: false,
      linkType: types.get(link.id)!,
      degree: degreeById.get(link.id) ?? 0,
      label: link.name,
      centroid: movingCentroid(link),
    };
    nodes.push(node);
    nodeById.set(link.id, node);
  }

  return {
    nodes,
    edges,
    jointCount: doc.joints.length,
    warnings,
    nodeById,
    nodeIdOfLink,
  };
}
