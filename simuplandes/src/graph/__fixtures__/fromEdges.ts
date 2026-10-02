/**
 * Test/E2E-only source of topology-only `MechanismDocument`s, built from an
 * abstract edge list (`[node, node][]`). Nodes sit on a deterministic circle
 * so every produced document is assembled by construction (joint sites
 * coincide in world space) and renders sensibly on the canvas. Used by
 * `src/graph`'s own tests and reused by later Phase 6 plans and E2E specs --
 * never by production code (excluded from coverage by the existing
 * `src/**\/__fixtures__/**` glob).
 */

import { vec2, add, sub, scale, perp, normalize, type Vec2 } from "../../geom";
import {
  createId,
  MechanismDocumentSchema,
  toTuple,
  type Id,
  type MechanismDocument,
} from "../../model";

export interface DocumentFromEdgesOptions {
  /** Node indices that become `isGround` links. Default `[0]`. */
  ground?: readonly number[];
  /** Edge indices whose joint becomes type `"P"` (axis `[1, 0]`). Default: none (all `"R"`). */
  prismatic?: readonly number[];
  name?: string;
  /** Anchor circle radius. Default 100. */
  radius?: number;
}

/**
 * The assembled document plus lookups from the original abstract node/edge
 * indices to real ids. `linkIdOf`/`jointIdOf` are plain function-typed
 * properties (not method shorthand) so they destructure safely without
 * tripping `@typescript-eslint/unbound-method` (they close over local state,
 * never `this`).
 */
export interface DocumentFromEdgesResult {
  doc: MechanismDocument;
  linkIdOf: (node: number) => Id;
  jointIdOf: (edgeIndex: number) => Id;
}

function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
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

function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (!out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)) out.push(p);
  }
  return out;
}

/** Builds a real, assembled `MechanismDocument` from an abstract edge list. */
export function documentFromEdges(
  edges: ReadonlyArray<readonly [number, number]>,
  options: DocumentFromEdgesOptions = {},
): DocumentFromEdgesResult {
  const radius = options.radius ?? 100;
  const groundSet = new Set(options.ground ?? [0]);
  const prismaticSet = new Set(options.prismatic ?? []);

  const nodeCount = edges.reduce((max, [u, v]) => Math.max(max, u, v), -1) + 1;

  const anchors: Vec2[] = [];
  for (let k = 0; k < nodeCount; k++) {
    const theta = (2 * Math.PI * k) / Math.max(nodeCount, 1);
    anchors.push(vec2(radius * Math.cos(theta), radius * Math.sin(theta)));
  }

  // One deterministic world joint point per edge; nudged along the
  // perpendicular (alternating sign by edge index) whenever the raw
  // midpoint would coincide with an already-placed joint point.
  const usedPoints: Vec2[] = [];
  const isTaken = (p: Vec2): boolean =>
    usedPoints.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9);

  const jointPoints: Vec2[] = edges.map(([u, v], e) => {
    const a = anchors[u];
    const b = anchors[v];
    const mid = scale(add(a, b), 0.5);
    const dir = normalize(sub(b, a));
    const perpDir = dir.x === 0 && dir.y === 0 ? vec2(0, 1) : perp(dir);
    const nudgeMag = 0.15 * radius;
    const sign = e % 2 === 0 ? 1 : -1;

    let point = mid;
    let attempt = 0;
    while (isTaken(point)) {
      attempt += 1;
      const s = attempt % 2 === 0 ? -sign : sign;
      point = add(mid, scale(perpDir, nudgeMag * attempt * s));
    }
    usedPoints.push(point);
    return point;
  });

  // Group incident (edge, otherNode) pairs per node, in edge order.
  const incidentByNode: { edgeIndex: number; siteId: Id }[][] = Array.from(
    { length: nodeCount },
    () => [],
  );
  const siteIdOf = new Map<string, Id>(); // `${node}:${edgeIndex}` -> site id
  edges.forEach(([u, v], e) => {
    const siteU = createId("site");
    const siteV = createId("site");
    siteIdOf.set(`${u}:${e}`, siteU);
    siteIdOf.set(`${v}:${e}`, siteV);
    incidentByNode[u].push({ edgeIndex: e, siteId: siteU });
    incidentByNode[v].push({ edgeIndex: e, siteId: siteV });
  });

  const linkIds: Id[] = [];
  const links: MechanismDocument["links"] = [];

  for (let k = 0; k < nodeCount; k++) {
    const linkId = createId("link");
    linkIds.push(linkId);
    const anchor = anchors[k];
    const incident = incidentByNode[k];
    const degree = incident.length;
    const isGround = groundSet.has(k);
    const name = isGround ? (groundSet.size === 1 ? "ground" : `ground-${k}`) : `L${k}`;

    const localPoints = incident.map(({ edgeIndex }) => sub(jointPoints[edgeIndex], anchor));

    const triangleOutline = (): [number, number][] => {
      const triangleRadius = Math.max(radius * 0.05, 1);
      return [
        toTuple(vec2(triangleRadius, 0)),
        toTuple(vec2(-triangleRadius, triangleRadius)),
        toTuple(vec2(-triangleRadius, -triangleRadius)),
      ];
    };

    const shape: MechanismDocument["links"][number]["shape"] =
      degree <= 2
        ? { kind: "bar" }
        : (() => {
            const distinct = dedupe(localPoints);
            const hull = distinct.length < 3 ? [] : convexHull(distinct);
            return {
              kind: "plate",
              outline: hull.length < 3 ? triangleOutline() : hull.map((p) => toTuple(p)),
            };
          })();

    links.push({
      id: linkId,
      name,
      isGround,
      pose: { position: toTuple(anchor), angle: 0 },
      shape,
      sites: incident.map(({ edgeIndex, siteId }) => ({
        id: siteId,
        name: "",
        local: toTuple(sub(jointPoints[edgeIndex], anchor)),
      })),
    });
  }

  const jointIds: Id[] = [];
  const joints: MechanismDocument["joints"] = edges.map(([u, v], e) => {
    const jointId = createId("joint");
    jointIds.push(jointId);
    const siteA = siteIdOf.get(`${u}:${e}`)!;
    const siteB = siteIdOf.get(`${v}:${e}`)!;
    return prismaticSet.has(e)
      ? {
          id: jointId,
          name: "",
          type: "P" as const,
          siteA,
          siteB,
          axis: [1, 0] as [number, number],
        }
      : { id: jointId, name: "", type: "R" as const, siteA, siteB };
  });

  const doc = MechanismDocumentSchema.parse({
    schemaVersion: 1,
    name: options.name ?? "fromEdges",
    units: { length: "mm" },
    links,
    joints,
    motors: [],
    markers: [],
    loads: [],
  });

  return {
    doc,
    linkIdOf: (node: number): Id => {
      const id = linkIds[node];
      if (id === undefined) throw new Error(`documentFromEdges: no node ${node}`);
      return id;
    },
    jointIdOf: (edgeIndex: number): Id => {
      const id = jointIds[edgeIndex];
      if (id === undefined) throw new Error(`documentFromEdges: no edge ${edgeIndex}`);
      return id;
    },
  };
}
