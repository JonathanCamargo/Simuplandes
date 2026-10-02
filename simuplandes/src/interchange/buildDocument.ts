/**
 * Anchored-pose studio document builder (09-01). Joint positions ->
 * editable `MechanismDocument`. Unlike `importGraphthe`'s default identity-
 * pose construction (kept for the byte-identical Phase 8 contract), each
 * MOVING link's pose origin is its first site's world point and its angle is
 * the direction first -> second site, so selection/rotation handles sit on
 * the link and a collinear plate cannot degenerate. Sites are link-local via
 * `worldToLinkLocal`; every site's world point equals the input `pos` within
 * ~1e-13. Ground (node 0) keeps the identity pose.
 *
 * Shape rule: a `bar` for <= 2 distinct site points, otherwise a `plate`
 * whose outline is the convex hull (a small triangle when the hull is
 * degenerate). Pure: no kinematics/sim imports.
 */

import { rotate, vec2 } from "../geom";
import {
  createId,
  MechanismDocumentSchema,
  worldToLinkLocal,
  type Id,
  type Link,
  type LinkShape,
  type MechanismDocument,
  type MechanismDocumentInput,
  type Pose,
  type Site,
} from "../model";
import type { Vec2Tuple } from "./importReport";
import type { ReadMarker } from "./readGraph";

export interface StudioBuildEdge {
  readonly u: number;
  readonly v: number;
  readonly kind: "R" | "P";
  readonly axis: Vec2Tuple | null;
  readonly pos: Vec2Tuple;
}

export interface StudioBuildInput {
  readonly name: string;
  readonly units: string | null;
  readonly nodeCount: number;
  readonly linkNames: readonly (readonly string[] | null)[];
  readonly edges: readonly StudioBuildEdge[];
  readonly inputEdge: number | null;
  readonly markers: readonly ReadMarker[];
}

/** Two points closer than this (world units) count as one site position. */
const COINCIDENT = 1e-9;
/** Half-size of the fallback triangle outline (link-local units). */
const TRIANGLE_RADIUS = 5;

function cross(o: Vec2Tuple, a: Vec2Tuple, b: Vec2Tuple): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone-chain convex hull (counter-clockwise, collinear points dropped). */
export function convexHull(points: readonly Vec2Tuple[]): Vec2Tuple[] {
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const lower: Vec2Tuple[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2Tuple[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function distinctPoints(points: readonly Vec2Tuple[]): Vec2Tuple[] {
  const out: Vec2Tuple[] = [];
  for (const p of points) {
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < COINCIDENT)) out.push(p);
  }
  return out;
}

function triangleOutline(): [number, number][] {
  return [
    [TRIANGLE_RADIUS, 0],
    [-TRIANGLE_RADIUS, TRIANGLE_RADIUS],
    [-TRIANGLE_RADIUS, -TRIANGLE_RADIUS],
  ];
}

function shapeFor(locals: readonly Vec2Tuple[]): LinkShape {
  const distinct = distinctPoints(locals);
  if (distinct.length <= 2) return { kind: "bar" };
  const hull = convexHull(distinct);
  return {
    kind: "plate",
    outline: hull.length >= 3 ? hull.map((p): [number, number] => [p[0], p[1]]) : triangleOutline(),
  };
}

/** Pose = first site's world point, angle toward the first site that differs from it (0 when none). */
function anchoredPose(points: readonly Vec2Tuple[]): Pose {
  if (points.length === 0) return { position: [0, 0], angle: 0 };
  const first = points[0];
  const second = points.find((p) => Math.hypot(p[0] - first[0], p[1] - first[1]) >= COINCIDENT);
  const angle = second ? Math.atan2(second[1] - first[1], second[0] - first[0]) : 0;
  return { position: [first[0], first[1]], angle };
}

const IDENTITY_POSE: Pose = { position: [0, 0], angle: 0 };

interface Incident {
  readonly edgeIndex: number;
  readonly other: number;
  readonly pos: Vec2Tuple;
}

interface BuiltNode {
  readonly pose: Pose;
  /** edge index -> site id on this node. */
  readonly siteOfEdge: Map<number, Id>;
}

function buildLink(
  name: string,
  isGround: boolean,
  pose: Pose,
  incidents: readonly Incident[],
  fallbackSite: Vec2Tuple,
): { link: Link; built: BuiltNode } {
  const siteOfEdge = new Map<number, Id>();
  let sites: Site[] = incidents.map((inc) => {
    const id = createId("site");
    siteOfEdge.set(inc.edgeIndex, id);
    return {
      id,
      name: `n${inc.other}`,
      local: worldToLinkLocal(pose, vec2(inc.pos[0], inc.pos[1])),
    };
  });
  // The schema rejects nothing here, but a link with no joints still needs a
  // visible anchor (an isolated node kept by `disconnected: "keep"`).
  if (sites.length === 0) {
    sites = [
      {
        id: createId("site"),
        name: "",
        local: worldToLinkLocal(pose, vec2(fallbackSite[0], fallbackSite[1])),
      },
    ];
  }
  const link: Link = {
    id: createId("link"),
    name,
    isGround,
    pose,
    shape: shapeFor(sites.map((s) => s.local)),
    sites,
  };
  return { link, built: { pose, siteOfEdge } };
}

/**
 * Builds the studio document. Node 0 is ground: one `isGround` link per
 * `linkNames[0]` entry (default `["link-0"]`), every joint site on the FIRST
 * ground link, extra ground links carrying a placeholder site. Moving node k
 * -> one link named `linkNames[k][0]` (default `link-<k>`). Joint siteA is
 * the lower node's site; a P axis is expressed in the siteA link's local
 * frame. `inputEdge` gets the only motor (rotary for R, linear for P,
 * constant speed 1). Parsed with `MechanismDocumentSchema`.
 */
export function buildStudioDocument(input: StudioBuildInput): MechanismDocument {
  return buildStudioDocumentDetailed(input).doc;
}

/** `buildStudioDocument` plus the link id -> node id map (every ground link -> 0). */
export function buildStudioDocumentDetailed(input: StudioBuildInput): {
  doc: MechanismDocument;
  nodeOfLink: Map<Id, number>;
} {
  const edges = input.edges.map((e) => ({
    lo: Math.min(e.u, e.v),
    hi: Math.max(e.u, e.v),
    kind: e.kind,
    axis: e.axis,
    pos: e.pos,
  }));

  const incidents: Incident[][] = Array.from({ length: input.nodeCount }, () => []);
  edges.forEach((e, edgeIndex) => {
    incidents[e.lo].push({ edgeIndex, other: e.hi, pos: e.pos });
    incidents[e.hi].push({ edgeIndex, other: e.lo, pos: e.pos });
  });

  const links: Link[] = [];
  const nodes: (BuiltNode | null)[] = [];
  const linkOfNode = new Map<number, Link>();

  for (let k = 0; k < input.nodeCount; k++) {
    const pts = incidents[k].map((i) => i.pos);
    if (k === 0) {
      const given = input.linkNames[0] ?? null;
      if (given !== null && given.length === 0 && incidents[0].length === 0) {
        nodes.push(null);
        continue;
      }
      const names = given !== null && given.length > 0 ? given : ["link-0"];
      const first = buildLink(names[0], true, IDENTITY_POSE, incidents[0], [0, 0]);
      links.push(first.link);
      nodes.push(first.built);
      linkOfNode.set(0, first.link);
      const placeholder: Vec2Tuple = pts[0] ?? [0, 0];
      for (const name of names.slice(1)) {
        links.push(buildLink(name, true, IDENTITY_POSE, [], placeholder).link);
      }
      continue;
    }
    const name = input.linkNames[k]?.[0] ?? `link-${k}`;
    const { link, built } = buildLink(name, false, anchoredPose(pts), incidents[k], [0, 0]);
    links.push(link);
    nodes.push(built);
    linkOfNode.set(k, link);
  }

  const joints: MechanismDocumentInput["joints"] = [];
  const jointIds: Id[] = [];
  edges.forEach((e, edgeIndex) => {
    const nodeLo = nodes[e.lo];
    const nodeHi = nodes[e.hi];
    const siteA = nodeLo?.siteOfEdge.get(edgeIndex);
    const siteB = nodeHi?.siteOfEdge.get(edgeIndex);
    if (nodeLo === null || siteA === undefined || siteB === undefined) {
      throw new Error(`buildStudioDocument: missing site for edge (${e.lo}, ${e.hi})`);
    }
    const id = createId("joint");
    jointIds.push(id);
    const name = `${e.lo}-${e.hi}`;
    if (e.kind === "P") {
      const world = vec2(e.axis?.[0] ?? 1, e.axis?.[1] ?? 0);
      const local = rotate(world, -nodeLo.pose.angle);
      joints.push({ id, name, type: "P", siteA, siteB, axis: [local.x, local.y] });
    } else {
      joints.push({ id, name, type: "R", siteA, siteB });
    }
  });

  const motors: MechanismDocumentInput["motors"] = [];
  if (input.inputEdge !== null) {
    const edge = edges[input.inputEdge];
    const jointId = jointIds[input.inputEdge];
    if (edge === undefined || jointId === undefined) {
      throw new Error(`buildStudioDocument: no edge ${input.inputEdge}`);
    }
    motors.push({
      id: createId("motor"),
      name: "motor-0",
      jointId,
      kind: edge.kind === "P" ? "linear" : "rotary",
      drive: { mode: "constant", speed: 1 },
    });
  }

  const markers: MechanismDocumentInput["markers"] = input.markers.map((marker, i) => {
    const link = linkOfNode.get(marker.link);
    if (!link) {
      throw new Error(`buildStudioDocument: marker ${i} references unknown node ${marker.link}`);
    }
    return {
      id: createId("marker"),
      name: marker.name ?? `marker-${i}`,
      linkId: link.id,
      local: worldToLinkLocal(link.pose, vec2(marker.pos[0], marker.pos[1])),
    };
  });

  const doc: MechanismDocumentInput = {
    schemaVersion: 1,
    name: input.name,
    ...(input.units === "mm" || input.units === "m" ? { units: { length: input.units } } : {}),
    links,
    joints,
    motors,
    markers,
  };
  const nodeOfLink = new Map<Id, number>();
  for (const link of links) nodeOfLink.set(link.id, 0);
  for (const [node, link] of linkOfNode) nodeOfLink.set(link.id, node);
  return { doc: MechanismDocumentSchema.parse(doc), nodeOfLink };
}
