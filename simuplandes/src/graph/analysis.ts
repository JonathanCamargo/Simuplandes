/**
 * `analyzeDocument`/`getGraphAnalysis`: the single aggregator the graph
 * panel and canvas share (GRF-01/GRF-03/GRF-04) -- one call runs
 * `fromDocument` -> `graphMobility`/`linkAssortment`/`baranovCheck` ->
 * `identifyTopology(toIndexGraph(graph))`, and derives the three issue-id
 * sets a Baranov failure highlights on both views.
 *
 * `getGraphAnalysis` memoizes by document object identity in a module-level
 * `WeakMap`: `mechanismStore`'s documents are immutable snapshots (a new
 * object is only produced by `execute`/undo/redo/load), so identity is the
 * right cache key -- the same rationale as `DofBadge`'s own
 * `useMemo(() => computeDofReport(doc), [doc])` (research Pitfall 3). This
 * module is NEVER fed `simStore` data: the graph is always the Build-mode
 * reference-pose topology, pose-independent, regardless of Simulate-mode
 * playback.
 */

import type { Id, MechanismDocument } from "../model";
import { fromDocument } from "./fromDocument";
import { graphMobility, type GraphMobility } from "./mobility";
import { linkAssortment, type LinkAssortment } from "./linkAssortment";
import { baranovCheck, type BaranovResult } from "./baranov";
import { identifyTopology, type TopologyMatch } from "./identify";
import type { IndexGraph } from "./canonical";
import type { LinkGraph } from "./types";

/** Every structural fact + identification for one document, computed once. */
export interface GraphAnalysis {
  graph: LinkGraph;
  mobility: GraphMobility;
  assortment: LinkAssortment;
  baranov: BaranovResult;
  topology: TopologyMatch;
  /** Baranov offending `LinkGraph` node ids (empty unless `baranov.status === "fail"`). */
  issueNodeIds: ReadonlySet<Id>;
  /** Baranov offending joint ids. */
  issueEdgeIds: ReadonlySet<Id>;
  /** Baranov offending document link ids (the ground node, if offending, expands to every merged ground link id). */
  issueLinkIds: ReadonlySet<Id>;
}

/**
 * Adapts a `LinkGraph` to the plain index-labeled `IndexGraph` shape
 * `identifyTopology` consumes. `g.nodes` is already ground-first (see
 * `types.ts`'s own doc comment), so node index 0 is the ground node
 * whenever one exists -- no reordering needed here. Parallel edges are
 * preserved verbatim (not deduplicated), so a document with a duplicate
 * joint correctly makes `identifyTopology` report `notSimple`.
 */
export function toIndexGraph(g: LinkGraph): { graph: IndexGraph; nodeIds: Id[] } {
  const nodeIds = g.nodes.map((node) => node.id);
  const indexOf = new Map<Id, number>(nodeIds.map((id, i) => [id, i]));
  // Every edge endpoint is one of `g.nodes` by `LinkGraph`'s own contract
  // (see `types.ts`/`fromDocument.ts`), so both lookups are always defined.
  const edges: [number, number][] = g.edges.map((edge) => [
    indexOf.get(edge.a)!,
    indexOf.get(edge.b)!,
  ]);
  return { graph: { n: nodeIds.length, edges }, nodeIds };
}

/** Runs every structural check + topology identification for `doc`, from scratch. Pure; never mutates `doc`. */
export function analyzeDocument(doc: MechanismDocument): GraphAnalysis {
  const graph = fromDocument(doc);
  const mobility = graphMobility(graph);
  const assortment = linkAssortment(graph);
  const baranov = baranovCheck(graph);
  const { graph: indexGraph } = toIndexGraph(graph);
  const topology = identifyTopology(indexGraph);

  let issueNodeIds: ReadonlySet<Id> = new Set();
  let issueEdgeIds: ReadonlySet<Id> = new Set();
  let issueLinkIds: ReadonlySet<Id> = new Set();
  if (baranov.status === "fail") {
    issueNodeIds = new Set(baranov.nodeIds);
    issueEdgeIds = new Set(baranov.edgeIds);
    issueLinkIds = new Set(baranov.linkIds);
  }

  return {
    graph,
    mobility,
    assortment,
    baranov,
    topology,
    issueNodeIds,
    issueEdgeIds,
    issueLinkIds,
  };
}

const analysisByDocument = new WeakMap<MechanismDocument, GraphAnalysis>();

/**
 * Memoized `analyzeDocument`, keyed by `doc`'s own object identity (never
 * fed `simStore` data). The graph panel and canvas both call this for the
 * same `mechanismStore` document within one render pass, sharing one
 * computation instead of two.
 */
export function getGraphAnalysis(doc: MechanismDocument): GraphAnalysis {
  const cached = analysisByDocument.get(doc);
  if (cached) return cached;
  const analysis = analyzeDocument(doc);
  analysisByDocument.set(doc, analysis);
  return analysis;
}
