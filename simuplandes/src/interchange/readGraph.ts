/**
 * Tolerant graph reader (09-01). Text -> `{ graph, items }`; never throws.
 * Accepts the v1 `simuplandes-graphthe-export` envelope, a v0 `.gtm.json`
 * parity fixture, and a bare NetworkX node-link dict (`nodes` plus `edges`
 * or the older `links`), with or without joint positions. The strict
 * `parseGraphtheText` (the Phase 8 contract) is untouched; this reader is a
 * separate, permissive front end that produces report items instead of
 * exceptions.
 *
 * Node ids are normalized to `0..n-1` (numeric ids ascending, otherwise
 * string sort), keeping `originalId`. Optional per-node lengths come from a
 * node attribute `length` / `link_length`, or a top-level `link_lengths`
 * (object keyed by node id, or array by node index).
 */

import { z } from "zod";
import { LENGTH_UNITS } from "../model";
import {
  edgeKey,
  makeItem,
  type ImportFix,
  type ImportReportItem,
  type Vec2Tuple,
} from "./importReport";

export interface ReadNode {
  readonly id: number;
  readonly originalId: string | number;
  readonly linkNames: readonly string[] | null;
  readonly length: number | null;
}

export interface ReadEdge {
  readonly u: number;
  readonly v: number;
  readonly rawType: string | null;
  readonly axis: Vec2Tuple | null;
  readonly pos: Vec2Tuple | null;
  readonly input: boolean;
}

export interface ReadMarker {
  readonly link: number;
  readonly pos: Vec2Tuple;
  readonly name: string | null;
}

export interface ReadGraph {
  readonly source: "v1" | "v0" | "node-link";
  readonly name: string;
  readonly units: string | null;
  readonly nodes: readonly ReadNode[];
  readonly edges: readonly ReadEdge[];
  readonly markers: readonly ReadMarker[];
}

export const IMPORT_LIMITS: { readonly maxBytes: number; readonly maxNodes: number } = {
  maxBytes: 5 * 1024 * 1024,
  maxNodes: 64,
};

const GRAPHTHE_FORMAT = "simuplandes-graphthe-export";
const GTM_V0_FORMAT = "simuplandes-parity-fixture";
const DEFAULT_NAME = "Imported graph";

const IdSchema = z.union([z.number(), z.string()]);

const NodeSchema = z.looseObject({
  id: IdSchema,
  link_names: z.unknown().optional(),
  length: z.unknown().optional(),
  link_length: z.unknown().optional(),
});

const EdgeSchema = z.looseObject({
  source: IdSchema,
  target: IdSchema,
  pos: z.unknown().optional(),
  axis: z.unknown().optional(),
  type: z.unknown().optional(),
  input: z.unknown().optional(),
});

const GraphBodySchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

type RawNode = z.output<typeof NodeSchema>;
type RawEdge = z.output<typeof EdgeSchema>;

interface Fatal {
  readonly graph: null;
  readonly items: ImportReportItem[];
}

function fatal(
  code: "unparseable" | "unknown-format" | "too-large" | "empty-graph",
  params: ImportReportItem["params"] = {},
): Fatal {
  return { graph: null, items: [makeItem(code, "error", { params })] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTuple(value: unknown): Vec2Tuple | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]];
  }
  return null;
}

function asLength(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Normalization order: numeric ids ascending when all numeric, otherwise by string value. */
function sortedIds(ids: readonly (string | number)[]): (string | number)[] {
  const unique = [...new Set(ids)];
  const allNumeric = unique.every((id) => typeof id === "number");
  if (allNumeric) return unique.sort((a, b) => a - b);
  return unique.sort((a, b) => {
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

/** Finds the `{nodes, edges|links}` body: top level, or nested under `graph` (envelopes). */
function findBody(json: Record<string, unknown>): unknown {
  const candidates: unknown[] = [json, json.graph];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const edges = Array.isArray(candidate.edges) ? candidate.edges : candidate.links;
    if (Array.isArray(candidate.nodes) && Array.isArray(edges)) {
      return { nodes: candidate.nodes, edges };
    }
  }
  return null;
}

function pickName(json: Record<string, unknown>): string {
  if (typeof json.name === "string" && json.name.length > 0) return json.name;
  const inner = isRecord(json.graph) && isRecord(json.graph.graph) ? json.graph.graph : null;
  if (inner && typeof inner.name === "string" && inner.name.length > 0) return inner.name;
  return DEFAULT_NAME;
}

function lengthFromTop(
  json: Record<string, unknown>,
  originalId: string | number,
  index: number,
): number | null {
  const table = json.link_lengths;
  if (Array.isArray(table)) return asLength(table[index]);
  if (isRecord(table)) return asLength(table[String(originalId)]);
  return null;
}

function buildNodes(
  json: Record<string, unknown>,
  rawNodes: readonly RawNode[],
  order: readonly (string | number)[],
): ReadNode[] {
  const firstIndex = new Map<string | number, number>();
  rawNodes.forEach((n, i) => {
    if (!firstIndex.has(n.id)) firstIndex.set(n.id, i);
  });
  return order.map((originalId, id) => {
    const index = firstIndex.get(originalId) ?? 0;
    const raw = rawNodes[index];
    const names =
      Array.isArray(raw.link_names) && raw.link_names.every((s) => typeof s === "string")
        ? raw.link_names
        : null;
    const length =
      asLength(raw.length) ?? asLength(raw.link_length) ?? lengthFromTop(json, originalId, index);
    return { id, originalId, linkNames: names, length };
  });
}

const DROP_FIX: readonly ImportFix[] = [{ id: "drop", option: {} }];

function buildEdges(
  rawEdges: readonly RawEdge[],
  idOf: ReadonlyMap<string | number, number>,
  items: ImportReportItem[],
): ReadEdge[] | null {
  const edges: ReadEdge[] = [];
  const seen = new Set<string>();
  for (const raw of rawEdges) {
    const a = idOf.get(raw.source);
    const b = idOf.get(raw.target);
    if (a === undefined || b === undefined) return null;
    const key = edgeKey(a, b);
    if (a === b) {
      items.push(
        makeItem("self-loop", "warning", {
          nodeIds: [a],
          edgeKeys: [key],
          fixes: DROP_FIX,
          activeFixId: "drop",
        }),
      );
      continue;
    }
    if (seen.has(key)) {
      items.push(
        makeItem("duplicate-edge", "warning", {
          nodeIds: [Math.min(a, b), Math.max(a, b)],
          edgeKeys: [key],
          fixes: DROP_FIX,
          activeFixId: "drop",
        }),
      );
      continue;
    }
    seen.add(key);
    edges.push({
      u: Math.min(a, b),
      v: Math.max(a, b),
      rawType: typeof raw.type === "string" ? raw.type.toLowerCase() : null,
      axis: asTuple(raw.axis),
      pos: asTuple(raw.pos),
      input: raw.input === true,
    });
  }
  return edges;
}

function buildMarkers(
  json: Record<string, unknown>,
  idOf: ReadonlyMap<string | number, number>,
): ReadMarker[] {
  if (!Array.isArray(json.markers)) return [];
  const markers: ReadMarker[] = [];
  for (const raw of json.markers as unknown[]) {
    if (!isRecord(raw)) continue;
    const linkKey = raw.link;
    if (typeof linkKey !== "number" && typeof linkKey !== "string") continue;
    const link = idOf.get(linkKey);
    const pos = asTuple(raw.pos);
    if (link === undefined || pos === null) continue;
    markers.push({ link, pos, name: typeof raw.name === "string" ? raw.name : null });
  }
  return markers;
}

function sniffSource(json: Record<string, unknown>): "v1" | "v0" | "node-link" | null {
  if (json.format === GRAPHTHE_FORMAT) return json.version === 1 ? "v1" : null;
  if (json.format === GTM_V0_FORMAT) return json.version === 0 ? "v0" : null;
  return "node-link";
}

function read(
  text: string,
  limits: { readonly maxBytes: number; readonly maxNodes: number },
): { graph: ReadGraph | null; items: ImportReportItem[] } {
  if (text.length > limits.maxBytes) {
    return fatal("too-large", { what: "bytes", limit: limits.maxBytes, actual: text.length });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fatal("unparseable");
  }
  if (!isRecord(json)) return fatal("unknown-format");

  const source = sniffSource(json);
  if (source === null) return fatal("unknown-format", { format: String(json.format) });
  const rawBody = findBody(json);
  const body = rawBody === null ? null : GraphBodySchema.safeParse(rawBody);
  if (body === null || !body.success) return fatal("unknown-format");

  const { nodes: rawNodes, edges: rawEdges } = body.data;
  const order = sortedIds(rawNodes.map((n) => n.id));
  if (order.length > limits.maxNodes) {
    return fatal("too-large", { what: "nodes", limit: limits.maxNodes, actual: order.length });
  }
  if (order.length === 0 || rawEdges.length === 0) return fatal("empty-graph");

  const idOf = new Map<string | number, number>();
  order.forEach((orig, id) => idOf.set(orig, id));

  const items: ImportReportItem[] = [];
  const edges = buildEdges(rawEdges, idOf, items);
  if (edges === null) return fatal("unknown-format", { reason: "dangling-edge" });
  if (edges.length === 0) return fatal("empty-graph");

  let units: string | null = null;
  if (typeof json.units === "string" && json.units.length > 0) {
    units = json.units;
    if (!(LENGTH_UNITS as readonly string[]).includes(units)) {
      items.push(makeItem("units-unknown", "info", { params: { units } }));
    }
  }

  return {
    graph: {
      source,
      name: pickName(json),
      units,
      nodes: buildNodes(json, rawNodes, order),
      edges,
      markers: buildMarkers(json, idOf),
    },
    items,
  };
}

/** Reads graph text into a normalized `ReadGraph`. Never throws; fatal problems become `fatal: true` items with `graph: null`. */
export function readGraph(
  text: string,
  limits: Partial<typeof IMPORT_LIMITS> = {},
): { graph: ReadGraph | null; items: ImportReportItem[] } {
  try {
    return read(text, { ...IMPORT_LIMITS, ...limits });
  } catch {
    return fatal("unknown-format");
  }
}
