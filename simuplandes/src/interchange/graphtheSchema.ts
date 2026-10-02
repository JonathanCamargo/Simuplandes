/**
 * The `simuplandes-graphthe-export` v1 envelope (XCH-01/XCH-04): a
 * NetworkX-node-link-shaped superset of the Phase 7/7.1 `.gtm.json` parity
 * fixture format (`scripts/gtm/fixture.ts`, format
 * `"simuplandes-parity-fixture"`, version 0). `graphthe.ts` writes it;
 * `parseGraphtheText` reads BOTH the v1 shape and a v0 `.gtm.json` (all 15
 * checked-in fixtures remain valid inputs, doubling as the golden export
 * set — see `fixtures/README.md`).
 *
 * `doc["graph"]` (the envelope's nested `graph` key) is exactly the shape
 * `nx.node_link_graph(doc["graph"], edges="edges")` expects: explicit
 * `directed: false`/`multigraph: false` (NetworkX's own `multigraph`
 * default is `true` — omitting it would silently load a `MultiGraph`), an
 * empty `graph: {}` (graph-level attrs, unused here), `nodes`, `edges`.
 *
 * Unlike `.gtm.json`'s `parseGtmFixture`, this reader does NOT require
 * exactly one `input: true` edge, nor reject a prismatic input edge —
 * warn-but-allow exports (08-04's job) must stay readable here.
 */

import { z } from "zod";

/** The v1 envelope's own format string. */
export const GRAPHTHE_FORMAT = "simuplandes-graphthe-export";
/** The v1 envelope's version literal. */
export const GRAPHTHE_VERSION = 1 as const;
/** The checked-in golden export file suffix (parallel to `.gtm.json`/`.curve.json`). */
export const GRAPHTHE_FILE_SUFFIX = ".graphthe.json";

/** The `.gtm.json` v0 format string this reader also accepts. */
const GTM_V0_FORMAT = "simuplandes-parity-fixture";

/**
 * A graph node = a link. `link_type`/`link_names` are optional on READ (a
 * v0 `.gtm.json` node has neither `link_names` and only an optional
 * `link_type`); the v1 WRITER always emits both.
 */
export const GraphtheNodeSchema = z.object({
  id: z.number().int().nonnegative(),
  link_type: z.string().min(1).optional(),
  link_names: z.array(z.string()).optional(),
});

/**
 * A graph edge = a joint. `type`/`axis` only ever appear together on a
 * prismatic edge; a revolute edge omits both. `input: true` marks the one
 * edge driven by a motor (omitted otherwise).
 */
export const GraphtheEdgeSchema = z.object({
  source: z.number().int().nonnegative(),
  target: z.number().int().nonnegative(),
  pos: z.tuple([z.number(), z.number()]),
  input: z.boolean().optional(),
  type: z.enum(["revolute", "prismatic"]).optional(),
  axis: z.tuple([z.number(), z.number()]).optional(),
});

/** A marker: an absolute reference-pose world point on a node's link. */
export const GraphtheMarkerSchema = z.object({
  link: z.number().int().nonnegative(),
  pos: z.tuple([z.number(), z.number()]),
  name: z.string().optional(),
});

/** The nested NetworkX node-link graph dict (`doc["graph"]`). */
export const GraphtheGraphSchema = z.object({
  directed: z.literal(false),
  multigraph: z.literal(false),
  graph: z.record(z.string(), z.unknown()),
  nodes: z.array(GraphtheNodeSchema),
  edges: z.array(GraphtheEdgeSchema),
});

/** The full v1 envelope. */
export const GraphtheExportSchema = z.object({
  format: z.literal(GRAPHTHE_FORMAT),
  version: z.literal(GRAPHTHE_VERSION),
  name: z.string(),
  units: z.string().optional(),
  source: z.object({ app: z.string(), version: z.string() }).optional(),
  graph: GraphtheGraphSchema,
  markers: z.array(GraphtheMarkerSchema).default([]),
});

export type GraphtheNode = z.output<typeof GraphtheNodeSchema>;
export type GraphtheEdge = z.output<typeof GraphtheEdgeSchema>;
export type GraphtheMarker = z.output<typeof GraphtheMarkerSchema>;
export type GraphtheGraph = z.output<typeof GraphtheGraphSchema>;
export type GraphtheExport = z.output<typeof GraphtheExportSchema>;

/** The `.gtm.json` v0 envelope shape (a duplicate, minimal subset of `scripts/gtm/fixture.ts`'s `GtmFixtureSchema` — `src/interchange` may not import `scripts/`, the Node-only seam). */
const GraphtheV0EnvelopeSchema = z.object({
  format: z.literal(GTM_V0_FORMAT),
  version: z.literal(0),
  name: z.string().min(1),
  graph: z.object({
    nodes: z.array(GraphtheNodeSchema).min(1),
    edges: z.array(GraphtheEdgeSchema).min(1),
  }),
  markers: z.array(GraphtheMarkerSchema).default([]),
});

/**
 * Structural checks shared by both format versions: every edge's
 * source/target resolve to a known node id; no two edges share the same
 * unordered node pair (the exported graph must stay simple, never a
 * multigraph); a prismatic edge carries a non-zero, finite `axis` and a
 * revolute edge carries none; every marker's `link` resolves to a known
 * node id. Throws a plain `Error` (never a `ZodError`) on violation.
 */
function validateGraphStructure(graph: GraphtheGraph, markers: readonly GraphtheMarker[]): void {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const seenPairs = new Set<string>();

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(
        `parseGraphtheText: edge (${edge.source}, ${edge.target}) references an unknown node`,
      );
    }
    const lo = Math.min(edge.source, edge.target);
    const hi = Math.max(edge.source, edge.target);
    const key = `${lo}-${hi}`;
    if (seenPairs.has(key)) {
      throw new Error(`parseGraphtheText: duplicate edge (${lo}, ${hi})`);
    }
    seenPairs.add(key);

    if (edge.type === "prismatic") {
      const axis = edge.axis;
      const finite = axis !== undefined && Number.isFinite(axis[0]) && Number.isFinite(axis[1]);
      const nonZero = axis !== undefined && Math.hypot(axis[0], axis[1]) !== 0;
      if (!finite || !nonZero) {
        throw new Error(
          `parseGraphtheText: prismatic edge (${lo}, ${hi}) requires a non-zero, finite axis`,
        );
      }
    } else if (edge.axis) {
      throw new Error(`parseGraphtheText: revolute edge (${lo}, ${hi}) must not carry an axis`);
    }
  }

  for (const marker of markers) {
    if (!nodeIds.has(marker.link)) {
      throw new Error(`parseGraphtheText: marker references unknown node ${marker.link}`);
    }
  }
}

/**
 * Parses a v1 `simuplandes-graphthe-export` envelope OR a v0 `.gtm.json`
 * (`simuplandes-parity-fixture`) — the latter normalized to the v1 shape
 * (`directed: false`, `multigraph: false`, `graph: {}`, no `units`/
 * `source`/`link_names`/marker names). Throws a clear `Error` for an
 * unknown format/version or any `validateGraphStructure` violation.
 */
export function parseGraphtheText(text: string): GraphtheExport {
  const json: unknown = JSON.parse(text);
  if (typeof json !== "object" || json === null) {
    throw new Error("parseGraphtheText: expected a JSON object");
  }
  const { format, version } = json as { format?: unknown; version?: unknown };

  if (format === GRAPHTHE_FORMAT) {
    if (version !== GRAPHTHE_VERSION) {
      throw new Error(
        `parseGraphtheText: unsupported version ${JSON.stringify(version)} for format "${GRAPHTHE_FORMAT}"`,
      );
    }
    const envelope = GraphtheExportSchema.parse(json);
    validateGraphStructure(envelope.graph, envelope.markers);
    return envelope;
  }

  if (format === GTM_V0_FORMAT) {
    if (version !== 0) {
      throw new Error(
        `parseGraphtheText: unsupported version ${JSON.stringify(version)} for format "${GTM_V0_FORMAT}"`,
      );
    }
    const v0 = GraphtheV0EnvelopeSchema.parse(json);
    const envelope = GraphtheExportSchema.parse({
      format: GRAPHTHE_FORMAT,
      version: GRAPHTHE_VERSION,
      name: v0.name,
      graph: {
        directed: false,
        multigraph: false,
        graph: {},
        nodes: v0.graph.nodes,
        edges: v0.graph.edges,
      },
      markers: v0.markers,
    });
    validateGraphStructure(envelope.graph, envelope.markers);
    return envelope;
  }

  throw new Error(`parseGraphtheText: unknown format ${JSON.stringify(format)}`);
}
