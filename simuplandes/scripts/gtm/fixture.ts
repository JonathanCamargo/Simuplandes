/**
 * The minimal `.gtm.json` parity-fixture schema (DMS-03): Zod validation,
 * structural checks, and conversion to a `MechanismDocument`. "gtm" =
 * "geometry-test-mechanism" — a minimal, forward-compatible subset of the
 * future NetworkX node-link interchange JSON (Phase 8 owns the real
 * schema); see `fixtures/README.md`.
 *
 * A fixture's `graph.nodes` are links (node 0 = ground); `graph.edges` are
 * joints, each carrying the joint's world position `pos` at the fixture's
 * reference pose (assembled by construction, matching this project's own
 * interchange convention: reference-pose joint positions are lossless and
 * branch-free). An edge is revolute (default) or prismatic (`type:
 * "prismatic"`, plus a non-zero `axis` — a world direction at the reference
 * pose, owned by the lower-numbered node). Exactly one edge is `input:
 * true` and it must touch ground and be revolute (linear-input fixtures
 * are not part of the parity sweep contract). `markers` are absolute
 * reference-pose points on a link.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  defineLink,
  makeDocument,
  type DefinedLink,
} from "../../src/kinematics/__fixtures__/build";
import { vec2, rotate } from "../../src/geom";
import { poseFromWorldPoints, worldToLinkLocal, createId } from "../../src/model";
import type { MechanismDocument, MechanismDocumentInput } from "../../src/model";

/** A `.gtm.json` link node. `link_type` is documentation only (never read by the solver). */
export const GtmNodeSchema = z.object({
  id: z.number().int().nonnegative(),
  link_type: z.string().min(1).optional(),
});

/**
 * A `.gtm.json` joint: an edge between two nodes, at a world reference
 * position. `type` is `"revolute"` (default, omit it) or `"prismatic"`; a
 * prismatic edge must carry a non-zero, finite `axis` (a world direction at
 * the reference pose, in the lower-numbered node's frame); a revolute edge
 * must not carry an `axis`.
 */
export const GtmEdgeSchema = z.object({
  source: z.number().int().nonnegative(),
  target: z.number().int().nonnegative(),
  pos: z.tuple([z.number(), z.number()]),
  input: z.boolean().optional(),
  type: z.enum(["revolute", "prismatic"]).optional(),
  axis: z.tuple([z.number(), z.number()]).optional(),
});

export type GtmEdge = z.output<typeof GtmEdgeSchema>;

/** `true` iff `edge.type === "prismatic"`; `undefined`/`"revolute"` are both revolute. */
export function isPrismatic(edge: Pick<GtmEdge, "type">): boolean {
  return edge.type === "prismatic";
}

/** A `.gtm.json` marker: an absolute reference-pose point on a link. */
export const GtmMarkerSchema = z.object({
  link: z.number().int().nonnegative(),
  pos: z.tuple([z.number(), z.number()]),
});

/** The minimal `.gtm.json` parity-fixture shape. */
export const GtmFixtureSchema = z.object({
  format: z.literal("simuplandes-parity-fixture"),
  version: z.literal(0),
  name: z.string().min(1),
  description: z.string().optional(),
  graph: z.object({
    nodes: z.array(GtmNodeSchema).min(1),
    edges: z.array(GtmEdgeSchema).min(1),
  }),
  markers: z.array(GtmMarkerSchema).default([]),
});

export type GtmFixture = z.output<typeof GtmFixtureSchema>;

function edgeKey(source: number, target: number): string {
  const lo = Math.min(source, target);
  const hi = Math.max(source, target);
  return `${lo}-${hi}`;
}

/**
 * Parses and structurally validates a `.gtm.json` fixture's text. Throws on
 * a schema violation OR any of: node 0 missing, a duplicate edge (same
 * unordered node pair twice), an edge referencing an unknown node, not
 * exactly one `input: true` edge, an input edge that does not touch node 0,
 * or a marker referencing an unknown link.
 */
export function parseGtmFixture(text: string): GtmFixture {
  const json: unknown = JSON.parse(text);
  const fixture = GtmFixtureSchema.parse(json);

  const nodeIds = new Set(fixture.graph.nodes.map((n) => n.id));
  if (!nodeIds.has(0)) {
    throw new Error(`fixture "${fixture.name}": node 0 (ground) is missing`);
  }

  const seenEdges = new Set<string>();
  for (const edge of fixture.graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(
        `fixture "${fixture.name}": edge (${edge.source}, ${edge.target}) references an unknown node`,
      );
    }
    const key = edgeKey(edge.source, edge.target);
    if (seenEdges.has(key)) {
      throw new Error(`fixture "${fixture.name}": duplicate edge (${key})`);
    }
    seenEdges.add(key);

    if (isPrismatic(edge)) {
      if (!edge.axis) {
        throw new Error(`fixture "${fixture.name}": prismatic edge (${key}) requires an axis`);
      }
      const [ax, ay] = edge.axis;
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || Math.hypot(ax, ay) === 0) {
        throw new Error(
          `fixture "${fixture.name}": prismatic edge (${key}) axis must be non-zero and finite`,
        );
      }
    } else if (edge.axis) {
      throw new Error(`fixture "${fixture.name}": revolute edge (${key}) must not carry an axis`);
    }
  }

  const inputEdges = fixture.graph.edges.filter((e) => e.input === true);
  if (inputEdges.length !== 1) {
    throw new Error(
      `fixture "${fixture.name}": expected exactly one input edge, found ${inputEdges.length}`,
    );
  }
  const [inputEdge] = inputEdges;
  if (inputEdge.source !== 0 && inputEdge.target !== 0) {
    throw new Error(`fixture "${fixture.name}": the input edge must touch ground (node 0)`);
  }
  if (isPrismatic(inputEdge)) {
    throw new Error(
      `fixture "${fixture.name}": the input edge (${edgeKey(inputEdge.source, inputEdge.target)}) must not be prismatic; linear-input fixtures are not part of the parity sweep contract`,
    );
  }

  for (const marker of fixture.markers) {
    if (!nodeIds.has(marker.link)) {
      throw new Error(`fixture "${fixture.name}": marker references unknown link ${marker.link}`);
    }
  }

  return fixture;
}

/** A validation issue reported by `validateGtmFixture` (never thrown). */
export interface GtmIssue {
  readonly code: "gruebler" | "coincident-joints" | "collinear-plate";
  readonly message: string;
}

/** A joint entry as seen from one of its two links: its world position and whether it's prismatic. */
interface JointEntry {
  readonly pos: readonly [number, number];
  readonly prismatic: boolean;
}

/** Every joint on each link (its world reference position + prismatic-ness), keyed by node id. */
function jointEntriesByLink(fx: GtmFixture): Map<number, JointEntry[]> {
  const byLink = new Map<number, JointEntry[]>();
  for (const node of fx.graph.nodes) byLink.set(node.id, []);
  for (const edge of fx.graph.edges) {
    const entry: JointEntry = { pos: edge.pos, prismatic: isPrismatic(edge) };
    byLink.get(edge.source)?.push(entry);
    byLink.get(edge.target)?.push(entry);
  }
  return byLink;
}

/** `max(bbox width, bbox height)` over every edge's reference-pose joint position. */
export function sizeOf(fx: GtmFixture): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const edge of fx.graph.edges) {
    const [x, y] = edge.pos;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/**
 * Reports (never throws) structural issues: Gruebler `F = 3(n-1) - 2j != 1`
 * (n = links, j = joints); two REVOLUTE joints of one link closer than
 * `1e-3 * sizeOf(fx)` (a prismatic joint is skipped by this check — a
 * slider/block link's revolute and prismatic joints are expected to
 * coincide at the reference pose); or a link with 3+ joints (ground
 * included) whose joints are near-collinear (`|cross| / maxPairwiseDist^2
 * < 0.05` for some triple).
 */
export function validateGtmFixture(fx: GtmFixture): GtmIssue[] {
  const issues: GtmIssue[] = [];
  const n = fx.graph.nodes.length;
  const j = fx.graph.edges.length;
  const gruebler = 3 * (n - 1) - 2 * j;
  if (gruebler !== 1) {
    issues.push({
      code: "gruebler",
      message: `Gruebler F = 3*(${n}-1) - 2*${j} = ${gruebler}, expected 1`,
    });
  }

  const size = sizeOf(fx);
  const minSeparation = 1e-3 * size;
  const byLink = jointEntriesByLink(fx);

  for (const [linkId, points] of byLink) {
    for (let a = 0; a < points.length; a++) {
      for (let b = a + 1; b < points.length; b++) {
        if (points[a].prismatic || points[b].prismatic) continue;
        const [ax, ay] = points[a].pos;
        const [bx, by] = points[b].pos;
        const d = Math.hypot(bx - ax, by - ay);
        if (d < minSeparation) {
          issues.push({
            code: "coincident-joints",
            message: `link ${linkId}: joints ${a} and ${b} are ${d} apart (< ${minSeparation})`,
          });
        }
      }
    }

    if (points.length >= 3) {
      let worstRatio = Infinity;
      for (let a = 0; a < points.length; a++) {
        for (let b = a + 1; b < points.length; b++) {
          for (let c = b + 1; c < points.length; c++) {
            const [ax, ay] = points[a].pos;
            const [bx, by] = points[b].pos;
            const [cx, cy] = points[c].pos;
            const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            const d1 = Math.hypot(bx - ax, by - ay);
            const d2 = Math.hypot(cx - ax, cy - ay);
            const d3 = Math.hypot(cx - bx, cy - by);
            const maxPairwise = Math.max(d1, d2, d3);
            const ratio = Math.abs(cross) / (maxPairwise * maxPairwise);
            if (ratio < worstRatio) worstRatio = ratio;
          }
        }
      }
      if (worstRatio < 0.05) {
        issues.push({
          code: "collinear-plate",
          message: `link ${linkId}: has a near-collinear joint triple (ratio ${worstRatio} < 0.05)`,
        });
      }
    }
  }

  return issues;
}

/**
 * Finds the first pair of DISTINCT points among `sites` (exact equality),
 * or `null` if every site coincides (e.g. a slider/block link authored
 * with all its joints at the same reference-pose point).
 */
function firstDistinctPair<T extends { pos: readonly [number, number] }>(
  sites: readonly T[],
): [T, T] | null {
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) {
      const [ax, ay] = sites[a].pos;
      const [bx, by] = sites[b].pos;
      if (ax !== bx || ay !== by) return [sites[a], sites[b]];
    }
  }
  return null;
}

/**
 * Builds a schema-valid `MechanismDocument` from a `.gtm.json` fixture.
 * One link per node (ground `isGround: true`); its sites are its joints'
 * world reference positions, named `n<otherNodeId>` (unique per link since
 * duplicate edges are rejected by `parseGtmFixture`). A moving link's pose
 * comes from the first pair of DISTINCT sites (`poseFromWorldPoints`); if
 * every site coincides (a slider/block link) the pose is `{origin: that
 * point, angle: 0}` instead. One joint per edge — R (`siteA`/`siteB`) or,
 * for a prismatic edge, P (`siteA` = the lower-numbered node's site, `axis`
 * = the fixture's world axis rotated into that link's local frame). Always
 * the ground site for the input edge. One rotary motor (`constant`, `speed:
 * 1`) on the (revolute) input joint. Markers convert to link-local via
 * `worldToLinkLocal`.
 */
export function gtmToDocument(fx: GtmFixture): MechanismDocument {
  const nodeIds = fx.graph.nodes.map((n) => n.id).sort((a, b) => a - b);

  const sitesByNode = new Map<number, { key: string; pos: readonly [number, number] }[]>();
  for (const id of nodeIds) sitesByNode.set(id, []);
  for (const edge of fx.graph.edges) {
    sitesByNode.get(edge.source)?.push({ key: `n${edge.target}`, pos: edge.pos });
    sitesByNode.get(edge.target)?.push({ key: `n${edge.source}`, pos: edge.pos });
  }

  const definedLinks = new Map<number, DefinedLink>();
  for (const id of nodeIds) {
    const nodeSites = sitesByNode.get(id) ?? [];
    const sitesRecord: Record<string, readonly [number, number]> = {};
    for (const s of nodeSites) sitesRecord[s.key] = s.pos;

    if (id === 0) {
      definedLinks.set(
        id,
        defineLink({ name: `link-${id}`, isGround: true, origin: [0, 0], sites: sitesRecord }),
      );
      continue;
    }

    let origin: readonly [number, number] = nodeSites[0]?.pos ?? [0, 0];
    let angle = 0;
    if (nodeSites.length >= 2) {
      const distinctPair = firstDistinctPair(nodeSites);
      if (distinctPair) {
        const pose = poseFromWorldPoints(
          vec2(distinctPair[0].pos[0], distinctPair[0].pos[1]),
          vec2(distinctPair[1].pos[0], distinctPair[1].pos[1]),
        );
        origin = pose.position;
        angle = pose.angle;
      }
      // else: every site coincides -> origin stays the (single) point, angle 0.
    }
    definedLinks.set(id, defineLink({ name: `link-${id}`, origin, angle, sites: sitesRecord }));
  }

  const links = nodeIds.map((id) => {
    const defined = definedLinks.get(id);
    if (!defined) throw new Error(`gtmToDocument: missing link for node ${id}`);
    return defined.link;
  });

  let inputJointId: string | null = null;
  const joints: MechanismDocumentInput["joints"] = fx.graph.edges.map((edge) => {
    const lo = Math.min(edge.source, edge.target);
    const hi = Math.max(edge.source, edge.target);
    const linkLo = definedLinks.get(lo);
    const linkHi = definedLinks.get(hi);
    if (!linkLo || !linkHi) throw new Error(`gtmToDocument: missing link for edge (${lo}, ${hi})`);
    const siteA = linkLo.siteIds[`n${hi}`];
    const siteB = linkHi.siteIds[`n${lo}`];
    const id = createId("joint");

    if (isPrismatic(edge)) {
      if (!edge.axis) {
        throw new Error(`gtmToDocument: prismatic edge (${lo}-${hi}) missing axis`);
      }
      const localAxis = rotate(vec2(edge.axis[0], edge.axis[1]), -linkLo.link.pose.angle);
      if (edge.input) inputJointId = id;
      return {
        id,
        name: `${lo}-${hi}`,
        type: "P" as const,
        siteA,
        siteB,
        axis: [localAxis.x, localAxis.y] as [number, number],
      };
    }

    if (edge.input) inputJointId = id;
    return { id, name: `${lo}-${hi}`, type: "R" as const, siteA, siteB };
  });

  if (!inputJointId) {
    throw new Error(`fixture "${fx.name}": no input joint found while building the document`);
  }

  const markers = fx.markers.map((marker, i) => {
    const link = definedLinks.get(marker.link);
    if (!link) throw new Error(`gtmToDocument: missing link for marker on node ${marker.link}`);
    const local = worldToLinkLocal(link.link.pose, vec2(marker.pos[0], marker.pos[1]));
    return {
      id: createId("marker"),
      name: `marker-${i}`,
      linkId: link.link.id,
      local,
    };
  });

  return makeDocument({
    schemaVersion: 1,
    name: fx.name,
    links,
    joints,
    motors: [
      {
        id: createId("motor"),
        name: "input-motor",
        jointId: inputJointId,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
    ],
    markers,
  });
}

/**
 * The input-link vector's reference-pose absolute world angle
 * (`theta_ref`): from the ground pivot `J(0, inputLink)` to the joint
 * shared with the input link's lowest-numbered non-ground neighbor.
 */
export function thetaRefOf(fx: GtmFixture): number {
  const inputEdge = fx.graph.edges.find((e) => e.input === true);
  if (!inputEdge) throw new Error(`fixture "${fx.name}": no input edge`);
  const groundPos = inputEdge.pos;
  const inputLink = inputEdge.source === 0 ? inputEdge.target : inputEdge.source;

  const neighborEdges = fx.graph.edges.filter(
    (e) => e !== inputEdge && (e.source === inputLink || e.target === inputLink),
  );
  if (neighborEdges.length === 0) {
    throw new Error(`fixture "${fx.name}": input link ${inputLink} has no other joint`);
  }

  let best = neighborEdges[0];
  let bestNeighbor = best.source === inputLink ? best.target : best.source;
  for (const edge of neighborEdges.slice(1)) {
    const neighbor = edge.source === inputLink ? edge.target : edge.source;
    if (neighbor < bestNeighbor) {
      best = edge;
      bestNeighbor = neighbor;
    }
  }

  const [gx, gy] = groundPos;
  const [jx, jy] = best.pos;
  return Math.atan2(jy - gy, jx - gx);
}

/** SHA-256 of `text` with `\r\n` normalized to `\n` first (hex digest). */
export function fixtureHash(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
