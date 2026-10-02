/**
 * `planImport` (09-01): the pure, re-runnable import pipeline behind the
 * import dialog, atlas browser and gallery.
 *
 *   read -> ground pick + relabel -> joint-type mapping -> component filter
 *        -> input selection -> positions mode (given | centroid | layout)
 *        -> studio build -> multi-joint info -> mobility verdict
 *
 * Every mapping problem is a data item (`ImportReportItem`) with fixes;
 * applying a fix means calling `planImport` again with the merged option.
 * Kinematics-free: layout and verification arrive through `deps`
 * (`src/sim/importDeps.ts` supplies the real ones).
 *
 * Layout contract (for 09-02): `LayoutResult.positions[i]` is the joint
 * position of `LayoutRequest.edges[i]` (one point per edge, world frame).
 */

import type { Id, MechanismDocument } from "../model";
import { buildStudioDocumentDetailed, type StudioBuildEdge } from "./buildDocument";
import {
  DEFAULT_IMPORT_OPTIONS,
  MOBILITY_TARGET_DEG,
  edgeKey,
  makeItem,
  type ImportDeps,
  type ImportFix,
  type ImportOptions,
  type ImportReportItem,
  type ImportSeverity,
  type LayoutControl,
  type LayoutRequest,
  type MobilityVerdict,
  type Vec2Tuple,
} from "./importReport";
import { findMultiJointGroups } from "./multiJoint";
import { readGraph, type ReadGraph, type ReadMarker, type ReadNode } from "./readGraph";

export interface ImportPlan {
  readonly graph: ReadGraph | null;
  readonly doc: MechanismDocument | null;
  readonly items: readonly ImportReportItem[];
  readonly counts: Record<ImportSeverity, number>;
  readonly fatal: boolean;
  readonly mode: "positions" | "layout" | null;
  readonly verdict: MobilityVerdict | null;
  /** Document link id -> normalized node id (all ground links -> 0). */
  readonly nodeOfLink: ReadonlyMap<string, number>;
}

const DEFAULT_AXIS: Vec2Tuple = [1, 0];

/** A graph edge after joint-type mapping. */
interface WorkEdge {
  readonly u: number;
  readonly v: number;
  readonly kind: "R" | "P";
  readonly axis: Vec2Tuple | null;
  readonly pos: Vec2Tuple | null;
  readonly input: boolean;
}

interface Work {
  readonly nodes: readonly ReadNode[];
  readonly edges: readonly WorkEdge[];
  readonly markers: readonly ReadMarker[];
}

// ---------------------------------------------------------------------------
// Stage 1: ground selection and relabelling
// ---------------------------------------------------------------------------

/** Options resolved over the defaults, with an out-of-range ground falling back to `auto`. */
function resolveOptions(options: Partial<ImportOptions>): ImportOptions {
  return { ...DEFAULT_IMPORT_OPTIONS, ...options };
}

/** True when some node was labelled 0 in the source (GraphThe: node 0 = ground). */
function hasSourceGround(graph: ReadGraph): boolean {
  return graph.nodes.some((n) => n.originalId === 0 || n.originalId === "0");
}

function chooseGround(graph: ReadGraph, option: ImportOptions["ground"]): number {
  if (typeof option === "number" && Number.isInteger(option) && option >= 0) {
    if (option < graph.nodes.length) return option;
  }
  const source = graph.nodes.find((n) => n.originalId === 0 || n.originalId === "0");
  return source ? source.id : 0;
}

/** Swaps node ids 0 and `ground` so the chosen ground is always node 0. */
function relabel(graph: ReadGraph, ground: number): Work & { edgesRaw: ReadGraph["edges"] } {
  const swap = (i: number): number => (i === ground ? 0 : i === 0 ? ground : i);
  const nodes = graph.nodes.map((n) => ({ ...n, id: swap(n.id) })).sort((a, b) => a.id - b.id);
  const edgesRaw = graph.edges.map((e) => {
    const a = swap(e.u);
    const b = swap(e.v);
    return { ...e, u: Math.min(a, b), v: Math.max(a, b) };
  });
  const markers = graph.markers.map((m) => ({ ...m, link: swap(m.link) }));
  return { nodes, edges: [], markers, edgesRaw };
}

// ---------------------------------------------------------------------------
// Stage 2: joint-type mapping
// ---------------------------------------------------------------------------

function hasUsableAxis(axis: Vec2Tuple | null): axis is Vec2Tuple {
  return axis !== null && Math.hypot(axis[0], axis[1]) > 0;
}

/** R/P mapping per edge with `unsupported-joint` / `prismatic-no-axis` items; skipped joints disappear. */
function mapJoints(
  edgesRaw: ReadGraph["edges"],
  options: ImportOptions,
  items: ImportReportItem[],
): WorkEdge[] {
  const out: WorkEdge[] = [];
  for (const e of edgesRaw) {
    const key = edgeKey(e.u, e.v);
    const base = { u: e.u, v: e.v, pos: e.pos, input: e.input };
    if (e.rawType === null || e.rawType === "revolute") {
      out.push({ ...base, kind: "R", axis: null });
      continue;
    }
    if (e.rawType === "prismatic") {
      if (hasUsableAxis(e.axis)) {
        out.push({ ...base, kind: "P", axis: e.axis });
        continue;
      }
      const fixes: ImportFix[] = [
        { id: "default-axis", option: { prismaticWithoutAxis: "default-axis" } },
        { id: "revolute", option: { prismaticWithoutAxis: "revolute" } },
      ];
      items.push(
        makeItem("prismatic-no-axis", "warning", {
          nodeIds: [e.u, e.v],
          edgeKeys: [key],
          fixes,
          activeFixId: options.prismaticWithoutAxis,
        }),
      );
      if (options.prismaticWithoutAxis === "default-axis") {
        out.push({ ...base, kind: "P", axis: DEFAULT_AXIS });
      } else {
        out.push({ ...base, kind: "R", axis: null });
      }
      continue;
    }
    // Unknown joint type (assumption A8).
    items.push(
      makeItem("unsupported-joint", "warning", {
        nodeIds: [e.u, e.v],
        edgeKeys: [key],
        params: { type: e.rawType },
        fixes: [
          { id: "revolute", option: { unsupportedJoints: "revolute" } },
          { id: "skip", option: { unsupportedJoints: "skip" } },
        ],
        activeFixId: options.unsupportedJoints,
      }),
    );
    if (options.unsupportedJoints === "revolute") out.push({ ...base, kind: "R", axis: null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 3: component filter
// ---------------------------------------------------------------------------

function reachableFromGround(nodeCount: number, edges: readonly WorkEdge[]): Set<number> {
  const adjacent: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const e of edges) {
    adjacent[e.u].push(e.v);
    adjacent[e.v].push(e.u);
  }
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of adjacent[node]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Number of connected components among `nodes` (used for the report params). */
function countComponents(nodes: readonly number[], edges: readonly WorkEdge[]): number {
  const left = new Set(nodes);
  let components = 0;
  while (left.size > 0) {
    const start = left.values().next().value as number;
    const adjacent = new Map<number, number[]>();
    for (const e of edges) {
      if (!left.has(e.u) && !left.has(e.v)) continue;
      adjacent.set(e.u, [...(adjacent.get(e.u) ?? []), e.v]);
      adjacent.set(e.v, [...(adjacent.get(e.v) ?? []), e.u]);
    }
    const queue = [start];
    left.delete(start);
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const next of adjacent.get(node) ?? []) {
        if (left.delete(next)) queue.push(next);
      }
    }
    components += 1;
  }
  return components;
}

function filterComponents(work: Work, options: ImportOptions, items: ImportReportItem[]): Work {
  const reached = reachableFromGround(work.nodes.length, work.edges);
  if (reached.size === work.nodes.length) return work;

  const unreached = work.nodes.map((n) => n.id).filter((id) => !reached.has(id));
  const strayEdges = work.edges.filter((e) => !reached.has(e.u));
  items.push(
    makeItem("disconnected", "warning", {
      nodeIds: unreached,
      edgeKeys: strayEdges.map((e) => edgeKey(e.u, e.v)),
      params: { nodes: unreached.length, components: countComponents(unreached, strayEdges) },
      fixes: [
        { id: "drop", option: { disconnected: "drop" } },
        { id: "keep", option: { disconnected: "keep" } },
      ],
      activeFixId: options.disconnected,
    }),
  );
  if (options.disconnected === "keep") return work;

  const renumber = new Map<number, number>();
  for (const node of work.nodes) if (reached.has(node.id)) renumber.set(node.id, renumber.size);
  return {
    nodes: work.nodes
      .filter((n) => reached.has(n.id))
      .map((n) => ({ ...n, id: renumber.get(n.id)! })),
    edges: work.edges
      .filter((e) => reached.has(e.u))
      .map((e) => ({ ...e, u: renumber.get(e.u)!, v: renumber.get(e.v)! })),
    markers: work.markers
      .filter((m) => reached.has(m.link))
      .map((m) => ({ ...m, link: renumber.get(m.link)! })),
  };
}

// ---------------------------------------------------------------------------
// Stage 4: input selection
// ---------------------------------------------------------------------------

/** GraphThe `_convention_input_link`: among node 0's ascending neighbours the first of degree 2, else the first. */
function conventionNeighbour(work: Work): number | null {
  const degree = new Map<number, number>();
  for (const e of work.edges) {
    degree.set(e.u, (degree.get(e.u) ?? 0) + 1);
    degree.set(e.v, (degree.get(e.v) ?? 0) + 1);
  }
  const neighbours = work.edges
    .filter((e) => e.u === 0)
    .map((e) => e.v)
    .sort((a, b) => a - b);
  if (neighbours.length === 0) return null;
  return neighbours.find((n) => degree.get(n) === 2) ?? neighbours[0];
}

function inputFix(u: number, v: number): ImportFix {
  return { id: `input-${u}-${v}`, option: { input: { u, v } }, params: { u, v } };
}

const NO_INPUT_FIX: ImportFix = { id: "none", option: { input: "none" } };

interface InputChoice {
  /** Index into `work.edges`, or null for no motor. */
  readonly edge: number | null;
}

function findEdge(work: Work, u: number, v: number): number {
  const lo = Math.min(u, v);
  const hi = Math.max(u, v);
  return work.edges.findIndex((e) => e.u === lo && e.v === hi);
}

function selectInput(work: Work, options: ImportOptions, items: ImportReportItem[]): InputChoice {
  const marked = work.edges.map((e, i) => (e.input ? i : -1)).filter((i) => i >= 0);
  const markedOnGround = marked.filter((i) => work.edges[i].u === 0);
  const groundEdges = work.edges.map((e, i) => (e.u === 0 ? i : -1)).filter((i) => i >= 0);

  // Ground-adjacent joints, convention edge first.
  const convention = conventionNeighbour(work);
  const conventionEdge = convention === null ? -1 : findEdge(work, 0, convention);
  const groundCandidates =
    conventionEdge >= 0
      ? [conventionEdge, ...groundEdges.filter((i) => i !== conventionEdge)]
      : groundEdges;

  // The default (auto) resolution.
  let autoEdge: number | null;
  if (marked.length === 1 && markedOnGround.length === 1) autoEdge = markedOnGround[0];
  else if (markedOnGround.length > 0) autoEdge = markedOnGround[0];
  else autoEdge = conventionEdge >= 0 ? conventionEdge : null;

  // The currently applied choice.
  let chosen: number | null = autoEdge;
  let activeId: string | null;
  const option = options.input;
  if (option === "none") {
    chosen = null;
    activeId = "none";
  } else if (option !== "auto" && findEdge(work, option.u, option.v) >= 0) {
    chosen = findEdge(work, option.u, option.v);
    const e = work.edges[chosen];
    activeId = inputFix(e.u, e.v).id;
  } else {
    const e = autoEdge === null ? null : work.edges[autoEdge];
    activeId = e === null ? null : inputFix(e.u, e.v).id;
  }

  const fixesFor = (indices: readonly number[], withNone: boolean): ImportFix[] => {
    const fixes = indices.map((i) => inputFix(work.edges[i].u, work.edges[i].v));
    return withNone ? [...fixes, NO_INPUT_FIX] : fixes;
  };

  if (marked.length === 0) {
    items.push(
      makeItem("missing-input", "warning", {
        fixes: fixesFor(groundCandidates, true),
        activeFixId: activeId,
      }),
    );
  } else if (marked.length > 1) {
    const candidates = markedOnGround.length > 0 ? markedOnGround : groundCandidates;
    items.push(
      makeItem("several-inputs", "warning", {
        edgeKeys: marked.map((i) => edgeKey(work.edges[i].u, work.edges[i].v)),
        params: { count: marked.length },
        fixes: fixesFor(candidates, markedOnGround.length === 0),
        activeFixId: activeId,
      }),
    );
  } else if (markedOnGround.length === 0) {
    const e = work.edges[marked[0]];
    items.push(
      makeItem("input-not-on-ground", "warning", {
        nodeIds: [e.u, e.v],
        edgeKeys: [edgeKey(e.u, e.v)],
        fixes: fixesFor(groundCandidates, true),
        activeFixId: activeId,
      }),
    );
  }
  return { edge: chosen };
}

// ---------------------------------------------------------------------------
// Stage 5: positions mode
// ---------------------------------------------------------------------------

/** Missing `pos` = midpoint of the centroids of the known points on the edge's two links; null when any edge cannot be filled. */
function fillFromCentroids(edges: readonly WorkEdge[]): Vec2Tuple[] | null {
  const known = new Map<number, Vec2Tuple[]>();
  for (const e of edges) {
    if (e.pos === null) continue;
    for (const node of [e.u, e.v]) known.set(node, [...(known.get(node) ?? []), e.pos]);
  }
  const centroid = (node: number): Vec2Tuple | null => {
    const pts = known.get(node);
    if (!pts || pts.length === 0) return null;
    const sum = pts.reduce<[number, number]>((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
  };
  const out: Vec2Tuple[] = [];
  for (const e of edges) {
    if (e.pos !== null) {
      out.push(e.pos);
      continue;
    }
    const a = centroid(e.u);
    const b = centroid(e.v);
    if (a === null || b === null) return null;
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

interface PositionsChoice {
  readonly mode: "positions" | "layout";
  /** One point per edge when `mode === "positions"`. */
  readonly positions: readonly Vec2Tuple[] | null;
}

function choosePositions(
  edges: readonly WorkEdge[],
  options: ImportOptions,
  items: ImportReportItem[],
): PositionsChoice {
  const given = edges.filter((e) => e.pos !== null).length;
  const all = given === edges.length;
  const partial = given > 0 && !all;
  const layout: PositionsChoice = { mode: "layout", positions: null };

  if (options.positions === "layout") {
    if (partial) items.push(partialItem("layout"));
    return layout;
  }
  if (all) return { mode: "positions", positions: edges.map((e) => e.pos!) };
  if (!partial) return layout;

  if (options.positions === "centroid") {
    const filled = fillFromCentroids(edges);
    if (filled !== null) {
      items.push(partialItem("centroid"));
      return { mode: "positions", positions: filled };
    }
  }
  items.push(partialItem("layout"));
  return layout;
}

function partialItem(active: "layout" | "centroid"): ImportReportItem {
  return makeItem("partial-positions", "warning", {
    fixes: [
      { id: "layout", option: { positions: "layout" } },
      { id: "centroid", option: { positions: "centroid" } },
    ],
    activeFixId: active,
  });
}

// ---------------------------------------------------------------------------
// Stage 6/7: layout, build, verdict
// ---------------------------------------------------------------------------

function toLayoutRequest(work: Work, inputEdge: number | null, variant: number): LayoutRequest {
  const lengths = work.nodes.map((n) => n.length);
  return {
    nodeCount: work.nodes.length,
    edges: work.edges.map((e) => ({ u: e.u, v: e.v, kind: e.kind, axis: e.axis })),
    inputEdge,
    lengths: lengths.some((l) => l !== null) ? lengths : null,
    variant,
  };
}

function buildFrom(
  graph: ReadGraph,
  work: Work,
  positions: readonly Vec2Tuple[],
  inputEdge: number | null,
  keepMarkers: boolean,
): { doc: MechanismDocument; nodeOfLink: Map<Id, number> } {
  const edges: StudioBuildEdge[] = work.edges.map((e, i) => ({
    u: e.u,
    v: e.v,
    kind: e.kind,
    axis: e.kind === "P" ? (e.axis ?? DEFAULT_AXIS) : null,
    pos: positions[i],
  }));
  return buildStudioDocumentDetailed({
    name: graph.name,
    units: graph.units,
    nodeCount: work.nodes.length,
    linkNames: work.nodes.map((n) => n.linkNames),
    edges,
    inputEdge,
    markers: keepMarkers ? work.markers : [],
  });
}

function verdictItems(
  verdict: MobilityVerdict,
  mode: "positions" | "layout",
  variant: number,
): ImportReportItem[] {
  const relayout: ImportFix = { id: "layout", option: { positions: "layout" } };
  const retry: ImportFix = { id: "retry-layout", option: { layoutVariant: variant + 1 } };
  const fixes: readonly ImportFix[] = mode === "layout" ? [relayout, retry] : [relayout];

  const ready = verdict.status === "ready";
  if (verdict.status === "assembly-failed") {
    return [makeItem("assembly-failed", "warning", { fixes })];
  }
  if (!ready || verdict.rankDof !== 1) {
    if (verdict.rankDof !== null && verdict.rankDof !== 1) {
      return [
        makeItem("dof-not-one", "warning", {
          params: {
            rankDof: verdict.rankDof,
            ...(verdict.gruebler === null ? {} : { gruebler: verdict.gruebler }),
          },
          fixes,
        }),
      ];
    }
    return [makeItem("not-drivable", "warning", { fixes })];
  }
  const lowRotary = verdict.inputKind !== "linear" && verdict.rangeDeg < MOBILITY_TARGET_DEG;
  const lowLinear =
    verdict.inputKind === "linear" && (verdict.linearTravel === null || verdict.linearTravel <= 0);
  if (lowRotary || lowLinear) {
    return [
      makeItem("low-mobility", "warning", {
        params: { rangeDeg: verdict.rangeDeg, threshold: MOBILITY_TARGET_DEG },
        fixes,
      }),
    ];
  }
  return [];
}

function multiJointItems(
  doc: MechanismDocument,
  nodeOfLink: ReadonlyMap<Id, number>,
): ImportReportItem[] {
  return findMultiJointGroups(doc, nodeOfLink).groups.map((group) =>
    makeItem("multi-joint", "info", {
      nodeIds: group.nodes,
      params: { links: group.nodes.length },
      fixes: [{ id: "keep-star", option: {} }],
      activeFixId: "keep-star",
    }),
  );
}

function summarize(items: readonly ImportReportItem[]): Record<ImportSeverity, number> {
  const counts: Record<ImportSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

function finish(
  graph: ReadGraph | null,
  items: readonly ImportReportItem[],
  rest: Partial<Pick<ImportPlan, "doc" | "mode" | "verdict" | "nodeOfLink">> = {},
): ImportPlan {
  return {
    graph,
    doc: rest.doc ?? null,
    items,
    counts: summarize(items),
    fatal: items.some((i) => i.fatal),
    mode: rest.mode ?? null,
    verdict: rest.verdict ?? null,
    nodeOfLink: rest.nodeOfLink ?? new Map<string, number>(),
  };
}

function fatalPlan(
  graph: ReadGraph | null,
  items: ImportReportItem[],
  code: "empty-graph",
): ImportPlan {
  return finish(graph, [...items, makeItem(code, "error")]);
}

/**
 * Plans an import. Pure apart from awaiting `deps.layout`; never throws for
 * bad input. `options` are merged over `DEFAULT_IMPORT_OPTIONS`; a fix is
 * applied by calling again with its `option` merged in.
 */
export async function planImport(
  text: string,
  options: Partial<ImportOptions> = {},
  deps: ImportDeps = {},
  ctl?: LayoutControl,
): Promise<ImportPlan> {
  const opts = resolveOptions(options);
  const read = readGraph(text);
  const items: ImportReportItem[] = [...read.items];
  const graph = read.graph;
  if (graph === null || read.items.some((i) => i.fatal)) return finish(graph, items);

  // Ground.
  const ground = chooseGround(graph, opts.ground);
  if (!hasSourceGround(graph)) {
    items.push(
      makeItem("no-ground", "warning", {
        fixes: graph.nodes.map((n) => ({
          id: `ground-${n.id}`,
          option: { ground: n.id },
          params: { node: n.id, original: String(n.originalId) },
        })),
        activeFixId: `ground-${ground}`,
      }),
    );
  }
  const relabeled = relabel(graph, ground);

  // Joints, components, input, positions.
  const mapped = mapJoints(relabeled.edgesRaw, opts, items);
  if (mapped.length === 0) return fatalPlan(graph, items, "empty-graph");
  const work = filterComponents(
    { nodes: relabeled.nodes, edges: mapped, markers: relabeled.markers },
    opts,
    items,
  );
  if (work.edges.length === 0) return fatalPlan(graph, items, "empty-graph");
  const input = selectInput(work, opts, items);
  const choice = choosePositions(work.edges, opts, items);

  // Positions: given/centroid, or layout via deps.
  let positions = choice.positions;
  let keepMarkers = true;
  if (choice.mode === "layout") {
    keepMarkers = false;
    if (!deps.layout) {
      items.push(makeItem("layout-unavailable", "error"));
      return finish(graph, items, { mode: "layout" });
    }
    const request = toLayoutRequest(work, input.edge, opts.layoutVariant);
    const result = await deps.layout(request, ctl);
    if (result.status === "cancelled") return finish(graph, items, { mode: "layout" });
    if (result.status === "lengths-infeasible") {
      items.push(
        makeItem("lengths-infeasible", "error", {
          params: { residual: result.lengthResidual ?? 0 },
        }),
      );
      return finish(graph, items, { mode: "layout" });
    }
    if (result.status === "not-one-dof") {
      items.push(
        makeItem("not-one-dof-topology", "warning", {
          params: { gruebler: 3 * (work.nodes.length - 1) - 2 * work.edges.length },
          fixes: [{ id: "retry-layout", option: { layoutVariant: opts.layoutVariant + 1 } }],
        }),
      );
    } else {
      items.push(
        makeItem("layout-applied", "info", {
          params: { tries: result.tries, rangeDeg: Math.round(result.rangeDeg * 10) / 10 },
        }),
      );
    }
    positions = result.positions;
    if (positions === null || positions.length !== work.edges.length) {
      return finish(graph, items, { mode: "layout" });
    }
  }
  if (positions === null) return finish(graph, items, { mode: choice.mode });

  // Build.
  let built: { doc: MechanismDocument; nodeOfLink: Map<Id, number> };
  try {
    built = buildFrom(graph, work, positions, input.edge, keepMarkers);
  } catch (error) {
    items.push(makeItem("unknown-format", "error", { params: { reason: String(error) } }));
    return finish(graph, items, { mode: choice.mode });
  }
  items.push(...multiJointItems(built.doc, built.nodeOfLink));

  const verdict = deps.verify ? deps.verify(built.doc) : null;
  if (verdict !== null) items.push(...verdictItems(verdict, choice.mode, opts.layoutVariant));

  return finish(graph, items, {
    doc: built.doc,
    mode: choice.mode,
    verdict,
    nodeOfLink: built.nodeOfLink,
  });
}
