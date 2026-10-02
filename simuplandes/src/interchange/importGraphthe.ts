/**
 * Headless JSON -> `MechanismDocument` importer for the GraphThe export
 * envelope (08-01 Task 2). Contract tests only — Phase 9 owns the real
 * import UI/auto-layout. The construction is deliberately lossless for the
 * export contract: every created link gets the IDENTITY reference pose
 * (`position [0,0]`, angle 0), so site link-local coordinates equal the
 * envelope's world `pos` values bit for bit and
 * exportGraphthe(importGraphthe(envelope)) is byte-identical.
 *
 * Mirrors `scripts/gtm/fixture.ts`'s `gtmToDocument` site naming
 * (`n<otherNode>`) and shape rule (bar for <= 2 distinct sites, plate
 * outline otherwise — the same rule `src/kinematics/__fixtures__/build.ts`
 * uses), but re-implements it locally: `src/interchange` may not import
 * `scripts/` (Node-only) nor `src/kinematics` (ESLint seam).
 */

import {
  createId,
  MechanismDocumentSchema,
  type Id,
  type Link,
  type LinkShape,
  type MechanismDocument,
  type MechanismDocumentInput,
  type Site,
} from "../model";
import { buildStudioDocument, type StudioBuildInput } from "./buildDocument";
import type { GraphtheExport, GraphtheMarker } from "./graphtheSchema";

/** Options for `importGraphthe`. The default (no options) output is the Phase 8 contract and never changes. */
export interface ImportGraphtheOptions {
  /** Opt in to the studio builder: anchored link poses, plate hulls (09-01). Re-export matches within ~1e-9, not byte-identical. */
  readonly anchoredPoses?: boolean;
}

/**
 * Converts a parsed envelope into a `StudioBuildInput`. Node ids map to
 * indices by ascending id (contiguous `0..n-1` ids, what every exporter
 * writes, map to themselves); the input edge is the first `input: true` edge.
 */
function toStudioInput(envelope: GraphtheExport): StudioBuildInput {
  const ids = envelope.graph.nodes.map((n) => n.id).sort((a, b) => a - b);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const nodeByIndex = new Map(envelope.graph.nodes.map((n) => [indexOf.get(n.id) ?? 0, n]));
  const edges = envelope.graph.edges.map((edge) => ({
    u: indexOf.get(edge.source) ?? 0,
    v: indexOf.get(edge.target) ?? 0,
    kind: edge.type === "prismatic" ? ("P" as const) : ("R" as const),
    axis: edge.axis ?? null,
    pos: edge.pos,
  }));
  const inputEdge = envelope.graph.edges.findIndex((edge) => edge.input === true);
  return {
    name: envelope.name,
    units: envelope.units ?? null,
    nodeCount: ids.length,
    linkNames: ids.map((_, i) => nodeByIndex.get(i)?.link_names ?? null),
    edges,
    inputEdge: inputEdge >= 0 ? inputEdge : null,
    markers: envelope.markers.map((m) => ({
      link: indexOf.get(m.link) ?? 0,
      pos: m.pos,
      name: m.name ?? null,
    })),
  };
}

/** A node's incident edges, oriented as seen FROM that node. */
interface Incident {
  readonly other: number;
  readonly pos: readonly [number, number];
  readonly prismatic: boolean;
}

/** Collects each node's incident edges once (in edge order). */
function incidentsByNode(envelope: GraphtheExport): Map<number, Incident[]> {
  const byNode = new Map<number, Incident[]>();
  for (const node of envelope.graph.nodes) byNode.set(node.id, []);
  for (const edge of envelope.graph.edges) {
    byNode.get(edge.source)?.push({
      other: edge.target,
      pos: edge.pos,
      prismatic: edge.type === "prismatic",
    });
    byNode.get(edge.target)?.push({
      other: edge.source,
      pos: edge.pos,
      prismatic: edge.type === "prismatic",
    });
  }
  return byNode;
}

/** The plate-vs-bar shape rule: a plate when 3+ DISTINCT site positions. */
function shapeFor(positions: readonly (readonly [number, number])[]): LinkShape {
  const distinct: [number, number][] = [];
  for (const p of positions) {
    if (!distinct.some((d) => d[0] === p[0] && d[1] === p[1])) distinct.push([p[0], p[1]]);
  }
  return distinct.length >= 3 ? { kind: "plate", outline: distinct } : { kind: "bar" };
}

/** Builds one link at the IDENTITY pose from its sites' world positions. */
function buildNodeLink(
  name: string,
  isGround: boolean,
  positions: readonly (readonly [number, number])[],
): {
  link: Link;
  siteIds: Map<number, Id>;
  siteIdsByOther: (incidents: readonly Incident[]) => Map<number, Id>;
} {
  const sites: Site[] = positions.map((p) => ({
    id: createId("site"),
    name: "",
    local: [p[0], p[1]],
  }));
  const link: Link = {
    id: createId("link"),
    name,
    isGround,
    pose: { position: [0, 0], angle: 0 },
    shape: shapeFor(positions),
    sites,
  };
  const siteIds = new Map<number, Id>();
  sites.forEach((site, i) => siteIds.set(i, site.id));
  const siteIdsByOther = (incidents: readonly Incident[]): Map<number, Id> => {
    const byOther = new Map<number, Id>();
    incidents.forEach((incident, i) => byOther.set(incident.other, sites[i].id));
    return byOther;
  };
  return { link, siteIds, siteIdsByOther };
}

/**
 * Builds a `MechanismDocument` from a parsed v1 envelope (or a normalized
 * v0 `.gtm.json` via `parseGraphtheText`). Ground node -> one `isGround`
 * link per `link_names` entry (default `["link-0"]`), every joint site on
 * the FIRST ground link (extra ground links get a placeholder site at the
 * first ground site's position — the schema rejects a zero-site link);
 * moving node -> one link named `link_names[0]` (default `link-<id>`).
 * One site per (node, incident edge), named `n<otherNode>`. R edge -> R
 * joint (siteA = lower node's site); P edge -> P joint (siteA = lower
 * node's site, `axis` = the world axis unchanged — identity pose makes
 * link-local == world). One motor per `input: true` edge (rotary for R,
 * linear for P, constant speed 1). Markers keep their absolute points
 * (`local = pos`, node 0 -> first ground link), named from the marker or
 * `marker-<i>`. Parsed with `MechanismDocumentSchema` so an invalid build
 * fails loudly.
 */
export function importGraphthe(
  envelope: GraphtheExport,
  options: ImportGraphtheOptions = {},
): MechanismDocument {
  if (options.anchoredPoses === true) return buildStudioDocument(toStudioInput(envelope));
  const incidents = incidentsByNode(envelope);

  const links: Link[] = [];
  /** node id -> (other node id -> site id). */
  const sitesByNode = new Map<number, Map<number, Id>>();
  /** node id -> link id. */
  const linkOfNode = new Map<number, Id>();
  /** node id -> first-ground-link lookup (ground only). */
  let firstGroundLinkId: Id | null = null;

  for (const node of envelope.graph.nodes) {
    const nodeIncidents = incidents.get(node.id) ?? [];
    const positions = nodeIncidents.map((i) => i.pos);

    if (node.id === 0) {
      // v1 round-trip rule: an explicitly EMPTY `link_names` (a v1 export
      // of a no-ground document) re-imports as NO ground link; an absent
      // or non-empty one imports as 1+ isGround links (v0 default
      // `["link-0"]`). This keeps export->import->export byte-identical
      // both ways.
      if (node.link_names !== undefined && node.link_names.length === 0) {
        linkOfNode.set(0, "");
        continue;
      }
      const names = node.link_names && node.link_names.length > 0 ? node.link_names : ["link-0"];
      const first = buildNodeLink(names[0], true, positions);
      links.push(first.link);
      sitesByNode.set(0, first.siteIdsByOther(nodeIncidents));
      linkOfNode.set(0, first.link.id);
      firstGroundLinkId = first.link.id;

      // Extra ground links carry no joints; the schema requires >= 1 site,
      // so give each a placeholder site at the first ground site's position.
      const placeholder: readonly [number, number] = positions[0] ?? [0, 0];
      for (const name of names.slice(1)) {
        const extra = buildNodeLink(name, true, [placeholder]);
        links.push(extra.link);
      }
      continue;
    }

    const name = node.link_names?.[0] ?? `link-${node.id}`;
    const built = buildNodeLink(name, false, positions);
    links.push(built.link);
    sitesByNode.set(node.id, built.siteIdsByOther(nodeIncidents));
    linkOfNode.set(node.id, built.link.id);
  }

  const joints: MechanismDocumentInput["joints"] = [];
  const motorJointIds: { id: Id; linear: boolean }[] = [];
  for (const edge of envelope.graph.edges) {
    const lo = Math.min(edge.source, edge.target);
    const hi = Math.max(edge.source, edge.target);
    const siteA = sitesByNode.get(lo)?.get(hi);
    const siteB = sitesByNode.get(hi)?.get(lo);
    if (siteA === undefined || siteB === undefined) {
      throw new Error(`importGraphthe: missing site for edge (${lo}, ${hi})`);
    }
    const id = createId("joint");
    if (edge.type === "prismatic") {
      if (edge.axis === undefined) {
        throw new Error(`importGraphthe: prismatic edge (${lo}, ${hi}) has no axis`);
      }
      joints.push({
        id,
        name: `${lo}-${hi}`,
        type: "P",
        siteA,
        siteB,
        axis: [edge.axis[0], edge.axis[1]],
      });
      if (edge.input === true) motorJointIds.push({ id, linear: true });
    } else {
      joints.push({ id, name: `${lo}-${hi}`, type: "R", siteA, siteB });
      if (edge.input === true) motorJointIds.push({ id, linear: false });
    }
  }

  const motors: MechanismDocumentInput["motors"] = motorJointIds.map((m, i) => ({
    id: createId("motor"),
    name: `motor-${i}`,
    jointId: m.id,
    kind: m.linear ? ("linear" as const) : ("rotary" as const),
    drive: { mode: "constant" as const, speed: 1 },
  }));

  const markers: MechanismDocumentInput["markers"] = envelope.markers.map(
    (marker: GraphtheMarker, i) => {
      const linkId =
        marker.link === 0
          ? (firstGroundLinkId ?? linkOfNode.get(0) ?? "")
          : linkOfNode.get(marker.link);
      if (!linkId) {
        throw new Error(`importGraphthe: marker ${i} references unknown node ${marker.link}`);
      }
      return {
        id: createId("marker"),
        name: marker.name ?? `marker-${i}`,
        linkId,
        local: [marker.pos[0], marker.pos[1]],
      };
    },
  );

  const doc: MechanismDocumentInput = {
    schemaVersion: 1,
    name: envelope.name,
    ...(envelope.units ? { units: { length: envelope.units as "mm" | "m" } } : {}),
    links,
    joints,
    motors,
    markers,
  };

  return MechanismDocumentSchema.parse(doc);
}
