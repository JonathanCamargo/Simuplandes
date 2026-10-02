/**
 * `exportGraphthe`: `MechanismDocument` -> the `simuplandes-graphthe-export`
 * v1 envelope (XCH-01). Pure; builds on `src/graph/fromDocument.ts`'s
 * ground-merged `LinkGraph` (one merge convention project-wide) rather than
 * re-deriving ground-merging here. Never mutates `doc`; the envelope
 * carries no document ids.
 *
 * Frame/units: every `pos`/`axis`/marker point is the reference-pose WORLD
 * value exactly as drawn (no shift, rotation, normalization or unit
 * conversion — `units` is a label only), per PROJECT.md/CONTEXT's locked
 * decision.
 */

import {
  indexDocument,
  siteWorldPosition,
  type DocumentIndex,
  type Id,
  type MechanismDocument,
} from "../model";
import { rotate, vec2 } from "../geom";
import { fromDocument } from "../graph/fromDocument";
import { GROUND_NODE_ID, type LinkGraph } from "../graph/types";
import { linkTypeForJointCount } from "../canvas/linkType";
import {
  GRAPHTHE_FORMAT,
  GRAPHTHE_VERSION,
  type GraphtheEdge,
  type GraphtheExport,
  type GraphtheMarker,
  type GraphtheNode,
} from "./graphtheSchema";
import { findMultiJointGroups, planStarSplit, type StarSplitPlan } from "./multiJoint";

/** Kept equal to `package.json`'s `version` (asserted by `graphthe.test.ts`). */
export const SIMUPLANDES_VERSION = "0.1.0";

/** A structural note recorded (never thrown) while exporting. */
export interface ExportNote {
  readonly code:
    | "merged-ground"
    | "parallel-joint"
    | "ground-loop"
    | "dangling-joint"
    | "no-ground"
    | "multi-joint-split";
  readonly linkIds: readonly Id[];
  readonly jointIds: readonly Id[];
  /** Present only on `multi-joint-split`: the star plan (hub, kept/synthesized/dropped joints). */
  readonly split?: StarSplitPlan;
}

/** Everything `exportGraphthe` produces: the envelope, its serialized text, and id-mapping metadata for callers (e.g. 08-04's validation report, 08-05's UI). */
export interface GraphtheExportResult {
  readonly envelope: GraphtheExport;
  readonly text: string;
  /** Every document link id -> its exported node id (ground links all -> 0). */
  readonly nodeOfLink: ReadonlyMap<Id, number>;
  /** Exported node id -> the document link ids merged into it. */
  readonly linkIdsOfNode: ReadonlyMap<number, readonly Id[]>;
  /** Every document joint id -> its exported `[source, target]` edge, or `null` if it was not exported (ground-loop, dangling, a redundant parallel joint, or a dropped multi-joint cycle joint). */
  readonly edgeOfJoint: ReadonlyMap<Id, readonly [number, number] | null>;
  readonly notes: readonly ExportNote[];
}

/** `JSON.stringify(envelope, null, 2) + "\n"` — never hand-format or round a number. */
export function serializeGraphthe(envelope: GraphtheExport): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** One built edge plus its sort key, before the final (source, target)-ascending sort. */
interface BuiltEdge {
  readonly edge: GraphtheEdge;
  readonly lo: number;
  readonly hi: number;
}

/**
 * Builds the exported edge list (sorted by `(source, target)`) plus notes
 * for every joint that did not become an edge. Runs the 08-04 multi-joint
 * star split BEFORE the edges are emitted so the parallel-joint dedupe,
 * degrees and `link_type` all see the canonical star (never a cycle):
 * multi-joint group joints are replaced by the planned hub-x edges
 * (existing hub-x joints reused with their `input`; missing ones
 * synthesized at the group point; cycle-closing joints dropped).
 */
function buildEdges(
  doc: MechanismDocument,
  index: DocumentIndex,
  graph: LinkGraph,
  nodeIntId: ReadonlyMap<Id, number>,
  nodeOfLink: ReadonlyMap<Id, number>,
  motorsByJoint: ReadonlySet<Id>,
): {
  edges: GraphtheEdge[];
  notes: ExportNote[];
  edgeOfJoint: Map<Id, readonly [number, number] | null>;
} {
  const notes: ExportNote[] = [];
  const edgeOfJoint = new Map<Id, readonly [number, number] | null>();

  for (const warning of graph.warnings) {
    notes.push({
      code: warning.kind === "groundLoop" ? "ground-loop" : "dangling-joint",
      linkIds: [],
      jointIds: [warning.jointId],
    });
    edgeOfJoint.set(warning.jointId, null);
  }

  // 08-04: detect multi-joint groups and plan their star splits. Group
  // joints are consumed by the plan (never emitted as ordinary edges).
  const { groups } = findMultiJointGroups(doc, nodeOfLink);
  const splitPlans = groups.map((group) => planStarSplit(group, index, nodeOfLink));
  const jointsInGroups = new Set<Id>(
    splitPlans.flatMap((plan) => plan.group.joints.map((j) => j.id)),
  );

  for (const plan of splitPlans) {
    const linkIds = [...new Set(plan.group.joints.flatMap((j) => [j.siteA, j.siteB]))]
      .map((siteId) => index.sites.get(siteId)?.link.id)
      .filter((id): id is Id => id !== undefined);
    notes.push({
      code: "multi-joint-split",
      linkIds: [...new Set(linkIds)],
      jointIds: plan.group.joints.map((j) => j.id),
      split: plan,
    });
    for (const dropped of plan.droppedJointIds) edgeOfJoint.set(dropped, null);
  }

  const seenPairs = new Set<string>();
  const built: BuiltEdge[] = [];

  const emitEdge = (
    lo: number,
    hi: number,
    pos: readonly [number, number],
    jointId: Id | null,
  ): void => {
    const pairKey = `${lo}-${hi}`;
    if (seenPairs.has(pairKey)) return; // a multi-joint star edge colliding with an existing pair: keep the first
    seenPairs.add(pairKey);
    const edge: GraphtheEdge = { source: lo, target: hi, pos: [pos[0], pos[1]] };
    if (jointId !== null && motorsByJoint.has(jointId)) edge.input = true;
    built.push({ edge, lo, hi });
    if (jointId !== null) edgeOfJoint.set(jointId, [lo, hi]);
  };

  for (const gEdge of graph.edges) {
    if (jointsInGroups.has(gEdge.jointId)) continue; // handled by the star plan below

    const a = nodeIntId.get(gEdge.a);
    const b = nodeIntId.get(gEdge.b);
    if (a === undefined || b === undefined) {
      throw new Error(`exportGraphthe: unmapped graph node for joint ${gEdge.jointId}`);
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const pairKey = `${lo}-${hi}`;

    if (seenPairs.has(pairKey)) {
      notes.push({ code: "parallel-joint", linkIds: [], jointIds: [gEdge.jointId] });
      edgeOfJoint.set(gEdge.jointId, null);
      continue;
    }

    const joint = index.joints.get(gEdge.jointId);
    if (!joint) throw new Error(`exportGraphthe: missing joint ${gEdge.jointId}`);
    const siteAInfo = index.sites.get(joint.siteA);
    const siteBInfo = index.sites.get(joint.siteB);
    if (!siteAInfo || !siteBInfo) {
      throw new Error(`exportGraphthe: missing site for joint ${gEdge.jointId}`);
    }

    const pos =
      joint.type === "R"
        ? siteWorldPosition(siteAInfo.link, siteAInfo.site.local)
        : siteWorldPosition(siteBInfo.link, siteBInfo.site.local);

    if (!seenPairs.has(pairKey)) {
      const edge: GraphtheEdge = { source: lo, target: hi, pos: [pos.x, pos.y] };
      if (motorsByJoint.has(joint.id)) edge.input = true;
      if (joint.type === "P") {
        edge.type = "prismatic";
        const worldAxis = rotate(vec2(joint.axis[0], joint.axis[1]), siteAInfo.link.pose.angle);
        edge.axis = [worldAxis.x, worldAxis.y];
      }
      built.push({ edge, lo, hi });
      seenPairs.add(pairKey);
      edgeOfJoint.set(gEdge.jointId, [lo, hi]);
    }
  }

  // The star edges: hub-x at the group point (a kept joint's own siteA
  // world point equals the group point by definition of the group).
  for (const plan of splitPlans) {
    for (const starEdge of plan.edges) {
      const [lo, hi] = starEdge.nodes;
      if (lo === undefined || hi === undefined) continue;
      const kept = starEdge.jointId !== null ? index.joints.get(starEdge.jointId) : undefined;
      const pos = kept
        ? (() => {
            const siteAInfo = index.sites.get(kept.siteA);
            const p = siteAInfo
              ? siteWorldPosition(siteAInfo.link, siteAInfo.site.local)
              : plan.group.point;
            return [p.x, p.y] as const;
          })()
        : ([plan.group.point.x, plan.group.point.y] as const);
      emitEdge(lo, hi, pos, starEdge.jointId);
    }
  }

  built.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
  return { edges: built.map((b) => b.edge), notes, edgeOfJoint };
}

/** Builds the v1 export envelope + result metadata for `doc`. Pure; never mutates `doc`. */
export function exportGraphthe(doc: MechanismDocument): GraphtheExportResult {
  const index = indexDocument(doc);
  const graph = fromDocument(doc);

  const motorsByJoint = new Set<Id>(doc.motors.map((m) => m.jointId));

  // Ground is always exported node 0 (even with zero or several ground
  // links); moving links are nodes 1..n-1 in document order, matching
  // `LinkGraph.nodes`'s own ordering once the (possibly absent) ground
  // node is filtered out.
  const nodeIntId = new Map<Id, number>();
  nodeIntId.set(GROUND_NODE_ID, 0);
  const movingNodes = graph.nodes.filter((n) => !n.isGround);
  movingNodes.forEach((n, i) => nodeIntId.set(n.id, i + 1));

  const groundLinks = doc.links.filter((l) => l.isGround);
  const nodeOfLink = new Map<Id, number>();
  for (const link of groundLinks) nodeOfLink.set(link.id, 0);
  for (const node of movingNodes) {
    const id = nodeIntId.get(node.id);
    if (id !== undefined) nodeOfLink.set(node.linkIds[0], id);
  }

  const linkIdsOfNode = new Map<number, readonly Id[]>();
  linkIdsOfNode.set(
    0,
    groundLinks.map((l) => l.id),
  );
  for (const node of movingNodes) {
    const id = nodeIntId.get(node.id);
    if (id !== undefined) linkIdsOfNode.set(id, node.linkIds);
  }

  const groundNotes: ExportNote[] =
    groundLinks.length === 0
      ? [{ code: "no-ground", linkIds: [], jointIds: [] }]
      : groundLinks.length > 1
        ? [{ code: "merged-ground", linkIds: groundLinks.map((l) => l.id), jointIds: [] }]
        : [];

  const {
    edges,
    notes: edgeNotes,
    edgeOfJoint,
  } = buildEdges(doc, index, graph, nodeIntId, nodeOfLink, motorsByJoint);

  const degreeByNode = new Map<number, number>();
  for (const edge of edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
  }

  const nodes: GraphtheNode[] = [
    { id: 0, link_type: "ground", link_names: groundLinks.map((l) => l.name) },
  ];
  for (const node of movingNodes) {
    const id = nodeIntId.get(node.id);
    if (id === undefined) continue;
    const link = index.links.get(node.linkIds[0]);
    nodes.push({
      id,
      link_type: linkTypeForJointCount(degreeByNode.get(id) ?? 0),
      link_names: [link?.name ?? ""],
    });
  }
  nodes.sort((a, b) => a.id - b.id);

  const markers: GraphtheMarker[] = doc.markers.map((marker, i) => {
    const link = index.links.get(marker.linkId);
    const worldPos = link
      ? siteWorldPosition(link, marker.local)
      : { x: marker.local[0], y: marker.local[1] };
    const nodeId = nodeOfLink.get(marker.linkId) ?? 0;
    return {
      link: nodeId,
      pos: [worldPos.x, worldPos.y],
      name: marker.name.length > 0 ? marker.name : `marker-${i}`,
    };
  });

  const envelope: GraphtheExport = {
    format: GRAPHTHE_FORMAT,
    version: GRAPHTHE_VERSION,
    name: doc.name,
    units: doc.units.length,
    source: { app: "Simuplandes", version: SIMUPLANDES_VERSION },
    graph: {
      directed: false,
      multigraph: false,
      graph: {},
      nodes,
      edges,
    },
    markers,
  };

  return {
    envelope,
    text: serializeGraphthe(envelope),
    nodeOfLink,
    linkIdsOfNode,
    edgeOfJoint,
    notes: [...groundNotes, ...edgeNotes],
  };
}
