/**
 * Multi-joint detection + the star split plan (XCH-02, 08-04). Pure data
 * only -- `buildEdges` in `graphthe.ts` consumes the plan.
 *
 * What IS a multi-joint here: 3+ exported nodes (ground counts as node 0)
 * pinned at one point by REVOLUTE joints that form a connected component
 * under the relation "shares a link AND coincides at the reference pose".
 * The tool trace (pinTool/barTool/effects.ts, recorded in 08-04-SUMMARY):
 * a 3rd body lands on an EXISTING site (chained bars/plates reuse the
 * picked site; ground pivots get a fresh coincident ground site), so a
 * group's points are bit-identical or within one float round-trip of the
 * snap point -- well inside the tolerance below.
 *
 * Prismatic joints NEVER take part (a slider's R and P joints coincide at
 * the reference pose BY DESIGN -- the slider-crank shape is not a
 * multi-joint).
 *
 * The split: a star around one hub (hub = ground if it participates, else
 * the participant with the most incident joints in the group, tie -> lowest
 * exported node id) -- kinematically equivalent to the drawn pin cluster,
 * and canonical (a re-imported star re-exports identically).
 */

import {
  indexDocument,
  siteWorldPosition,
  type DocumentIndex,
  type Id,
  type Joint,
  type MechanismDocument,
} from "../model";
import type { Vec2 } from "../geom";

/**
 * Coincidence tolerance: `1e-9 * max(1, bounding-box diagonal of all
 * joint world points)` at the reference pose. Scaled like
 * `validateGtmFixture`'s `1e-3 * size` checks but 6 orders tighter --
 * the tools produce bit-identical or one-round-trip-off points, so this
 * only absorbs float noise, never genuinely distinct pins.
 */
export const MULTI_JOINT_TOLERANCE_SCALE = 1e-9;

/** One detected multi-joint group: the joints, their world point, the participating exported nodes. */
export interface MultiJointGroup {
  /** The group's joints, in document order. */
  readonly joints: readonly Joint[];
  /** The group's shared reference-pose world point (the first joint's siteA position). */
  readonly point: Vec2;
  /** Distinct exported node ids participating (ground = 0). */
  readonly nodes: readonly number[];
}

/** One planned star edge: `nodes` is `[lo, hi]` with `lo < hi`. */
export interface StarEdge {
  readonly nodes: readonly [number, number];
  /** The existing joint reused for this edge (its `input` carries over), or `null` = synthesized. */
  readonly jointId: Id | null;
}

/** The split plan for one group: hub, kept/synthesized/dropped joints. */
export interface StarSplitPlan {
  readonly group: MultiJointGroup;
  /** The hub exported node id (ground if it participates; else most-joints-then-lowest rule). */
  readonly hubNode: number;
  /** The star edges: hub-x for every other participant, exactly (participants - 1) edges. */
  readonly edges: readonly StarEdge[];
  /** Existing group joints that became an edge. */
  readonly keptJointIds: readonly Id[];
  /** Existing group joints dropped as redundant (they close a cycle the star does not need). */
  readonly droppedJointIds: readonly Id[];
}

/**
 * Finds multi-joint groups: connected components over REVOLUTE joints
 * where two joints are adjacent iff they share a link AND their
 * reference-pose world points coincide within tolerance. Only components
 * spanning >= 3 distinct exported nodes are multi-joints (2-link
 * coincidence is an ordinary pin).
 */
export function findMultiJointGroups(
  doc: MechanismDocument,
  nodeOfLink: ReadonlyMap<Id, number>,
): { groups: readonly MultiJointGroup[]; tolerance: number } {
  const index = indexDocument(doc);

  // Bounding-box diagonal of every joint's two site world points (the
  // tolerance scale). Empty docs -> 0 -> tolerance 1e-9 * max(1, 0) = 1e-9.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const revoluteJoints = doc.joints.filter(
    (j): j is Extract<Joint, { type: "R" }> => j.type === "R",
  );
  for (const joint of revoluteJoints) {
    for (const siteId of [joint.siteA, joint.siteB]) {
      const info = index.sites.get(siteId);
      if (!info) continue;
      const p = siteWorldPosition(info.link, info.site.local);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const diagonal = revoluteJoints.length > 0 ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const tolerance = MULTI_JOINT_TOLERANCE_SCALE * Math.max(1, diagonal);

  // Union-find over the revolute joints (adjacency: share a link + coincide).
  const jointPositions = new Map<Id, Vec2>();
  const jointLinkSets = new Map<Id, Set<Id>>();
  for (const joint of revoluteJoints) {
    const siteAInfo = index.sites.get(joint.siteA);
    const siteBInfo = index.sites.get(joint.siteB);
    const a = siteAInfo ? siteWorldPosition(siteAInfo.link, siteAInfo.site.local) : null;
    const b = siteBInfo ? siteWorldPosition(siteBInfo.link, siteBInfo.site.local) : null;
    jointPositions.set(joint.id, a ?? b ?? { x: 0, y: 0 });
    const links = new Set<Id>();
    if (siteAInfo) links.add(siteAInfo.link.id);
    if (siteBInfo) links.add(siteBInfo.link.id);
    jointLinkSets.set(joint.id, links);
  }

  const parent = new Map<Id, Id>();
  const find = (id: Id): Id => {
    let root = id;
    for (;;) {
      const p = parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    // Path compression.
    let cursor = id;
    while (cursor !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: Id, b: Id): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const joint of revoluteJoints) parent.set(joint.id, joint.id);

  for (let i = 0; i < revoluteJoints.length; i++) {
    for (let k = i + 1; k < revoluteJoints.length; k++) {
      const ji = revoluteJoints[i];
      const jk = revoluteJoints[k];
      const linksI = jointLinkSets.get(ji.id);
      const linksK = jointLinkSets.get(jk.id);
      if (!linksI || !linksK) continue;
      const sharesLink = [...linksI].some((l) => linksK.has(l));
      if (!sharesLink) continue;
      const pi = jointPositions.get(ji.id)!;
      const pk = jointPositions.get(jk.id)!;
      if (Math.hypot(pi.x - pk.x, pi.y - pk.y) > tolerance) continue;
      union(ji.id, jk.id);
    }
  }

  // Collect components in document joint order.
  const components = new Map<Id, Joint[]>();
  for (const joint of revoluteJoints) {
    const root = find(joint.id);
    const list = components.get(root) ?? [];
    list.push(joint);
    components.set(root, list);
  }

  const groups: MultiJointGroup[] = [];
  for (const joints of components.values()) {
    const nodeSet = new Set<number>();
    for (const joint of joints) {
      for (const linkId of jointLinkSets.get(joint.id) ?? []) {
        const node = nodeOfLink.get(linkId);
        if (node !== undefined) nodeSet.add(node);
      }
    }
    if (nodeSet.size < 3) continue;
    const firstInfo = index.sites.get(joints[0].siteA);
    const point = firstInfo
      ? siteWorldPosition(firstInfo.link, firstInfo.site.local)
      : jointPositions.get(joints[0].id)!;
    groups.push({ joints, point, nodes: [...nodeSet].sort((a, b) => a - b) });
  }

  return { groups, tolerance };
}

/**
 * Plans the star split for one group: hub = ground (node 0) if it
 * participates, else the participant with the most incident group joints
 * (tie -> lowest node id); exactly (participants - 1) edges hub-x, one
 * per other participant; an existing hub-x joint is REUSED (first in
 * document order, its `input` carries over), everything else is either
 * synthesized (needed but absent) or dropped (redundant -- closes a cycle
 * the star does not need).
 */
export function planStarSplit(
  group: MultiJointGroup,
  index: DocumentIndex,
  nodeOfLink: ReadonlyMap<Id, number>,
): StarSplitPlan {
  // Node ids each group joint touches.
  const jointNodes = group.joints.map((joint) => {
    const nodes = new Set<number>();
    for (const siteId of [joint.siteA, joint.siteB]) {
      const info = index.sites.get(siteId);
      if (!info) continue;
      const node = nodeOfLink.get(info.link.id);
      if (node !== undefined) nodes.add(node);
    }
    return { joint, nodes: [...nodes].sort((a, b) => a - b) };
  });

  const participants = new Set<number>();
  for (const { nodes } of jointNodes) for (const n of nodes) participants.add(n);
  if (participants.has(0)) {
    participants.delete(0);
    participants.add(0); // ground participates
  }

  // Hub: ground if present, else most incident joints, tie -> lowest node id.
  let hubNode: number;
  if (participants.has(0)) {
    hubNode = 0;
  } else {
    const incidence = new Map<number, number>();
    for (const { nodes } of jointNodes) {
      for (const n of nodes) incidence.set(n, (incidence.get(n) ?? 0) + 1);
    }
    hubNode = [...participants].sort(
      (a, b) => (incidence.get(b) ?? 0) - (incidence.get(a) ?? 0) || a - b,
    )[0]!;
  }

  // One edge per non-hub participant: reuse the first existing hub-x joint
  // (document order) if there is one, else synthesize.
  const edges: StarEdge[] = [];
  const keptJointIds: Id[] = [];
  const consumed = new Set<Id>();
  for (const participant of [...participants].sort((a, b) => a - b)) {
    if (participant === hubNode) continue;
    const existing = jointNodes.find(
      ({ joint, nodes }) =>
        !consumed.has(joint.id) && nodes.includes(hubNode) && nodes.includes(participant),
    );
    if (existing) {
      const lo = Math.min(hubNode, participant);
      const hi = Math.max(hubNode, participant);
      edges.push({ nodes: [lo, hi], jointId: existing.joint.id });
      keptJointIds.push(existing.joint.id);
      consumed.add(existing.joint.id);
    } else {
      const lo = Math.min(hubNode, participant);
      const hi = Math.max(hubNode, participant);
      edges.push({ nodes: [lo, hi], jointId: null });
    }
  }

  const droppedJointIds = group.joints.map((j) => j.id).filter((id) => !consumed.has(id));

  return { group, hubNode, edges, keptJointIds, droppedJointIds };
}
