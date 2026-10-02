/**
 * Test-only inline JSON builders for the tolerant importer (09-01). Each
 * returns graph TEXT exactly as a user would drop/paste it. Coverage-
 * excluded via the `src/**\/__fixtures__/**` glob; never imported by
 * production code.
 */

import { ATLAS_TOPOLOGIES } from "../../graph/atlasData";

export interface EdgeSpec {
  readonly source: number | string;
  readonly target: number | string;
  readonly pos?: readonly [number, number];
  readonly input?: boolean;
  readonly type?: string;
  readonly axis?: readonly [number, number];
}

export interface CaseOptions {
  readonly edgesKey?: "edges" | "links";
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly nodeExtras?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** A bare NetworkX node-link dict. */
export function nodeLinkText(
  nodeIds: readonly (number | string)[],
  edges: readonly EdgeSpec[],
  options: CaseOptions = {},
): string {
  return JSON.stringify({
    ...options.extra,
    nodes: nodeIds.map((id) => ({ id, ...options.nodeExtras?.[String(id)] })),
    [options.edgesKey ?? "edges"]: edges,
  });
}

/** The four-bar crank-rocker golden's geometry (node 0 = ground, 0-1 driven). */
export const FOURBAR_EDGES: readonly EdgeSpec[] = [
  { source: 0, target: 1, pos: [0, 0], input: true },
  { source: 0, target: 3, pos: [100, 0] },
  { source: 1, target: 2, pos: [20, 34.64101615137754] },
  { source: 2, target: 3, pos: [110, 80] },
];

const omitKey = (edges: readonly EdgeSpec[], key: keyof EdgeSpec): EdgeSpec[] =>
  edges.map(
    (e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) as unknown as EdgeSpec,
  );
const withoutInput = (edges: readonly EdgeSpec[]): EdgeSpec[] => omitKey(edges, "input");
const withoutPos = (edges: readonly EdgeSpec[]): EdgeSpec[] => omitKey(edges, "pos");

export const positionedFourBar = (): string => nodeLinkText([0, 1, 2, 3], FOURBAR_EDGES);

export const positionedFourBarLinks = (): string =>
  nodeLinkText([0, 1, 2, 3], FOURBAR_EDGES, { edgesKey: "links" });

/** Topology-only atlas T15 (8-bar), no positions. */
export const topologyOnlyEightBar = (): string => {
  const entry = ATLAS_TOPOLOGIES.find((t) => t.id === "T15");
  if (!entry) throw new Error("atlas T15 missing");
  return nodeLinkText(
    [0, 1, 2, 3, 4, 5, 6, 7],
    entry.graph.edges.map(([source, target]) => ({ source, target })),
    { extra: { name: "T15 topology" } },
  );
};

/** Four-bar with the `pos` of edge 1-2 removed. */
export const partialPositions = (): string =>
  nodeLinkText(
    [0, 1, 2, 3],
    FOURBAR_EDGES.map((e) => (e.source === 1 && e.target === 2 ? { ...e, pos: undefined } : e)),
  );

export const missingInput = (): string => nodeLinkText([0, 1, 2, 3], withoutInput(FOURBAR_EDGES));

export const severalInputs = (): string =>
  nodeLinkText(
    [0, 1, 2, 3],
    FOURBAR_EDGES.map((e) => (e.source === 0 && e.target === 3 ? { ...e, input: true } : e)),
  );

export const inputNotOnGround = (): string =>
  nodeLinkText(
    [0, 1, 2, 3],
    withoutInput(FOURBAR_EDGES).map((e) =>
      e.source === 1 && e.target === 2 ? { ...e, input: true } : e,
    ),
  );

/** Node ids 1..4: there is no node 0. */
export const noGround = (): string =>
  nodeLinkText(
    [1, 2, 3, 4],
    FOURBAR_EDGES.map((e) => ({
      ...e,
      source: Number(e.source) + 1,
      target: Number(e.target) + 1,
    })),
  );

export const duplicateAndSelfLoop = (): string =>
  nodeLinkText(
    [0, 1, 2, 3],
    [
      ...FOURBAR_EDGES,
      { source: 1, target: 1, pos: [5, 5] },
      { source: 2, target: 1, pos: [21, 35] },
    ],
  );

export const unknownJointType = (): string =>
  nodeLinkText(
    [0, 1, 2, 3],
    FOURBAR_EDGES.map((e) => (e.source === 1 && e.target === 2 ? { ...e, type: "spherical" } : e)),
  );

/** The slider-crank golden's geometry. */
export const SLIDER_EDGES: readonly EdgeSpec[] = [
  { source: 0, target: 1, pos: [0, 0], input: true },
  { source: 0, target: 3, pos: [154.22362358239153, 10], type: "prismatic", axis: [1, 0] },
  { source: 1, target: 2, pos: [34.64101615137755, 19.999999999999996] },
  { source: 2, target: 3, pos: [154.22362358239153, 10] },
];

export const prismaticNoAxis = (): string =>
  nodeLinkText([0, 1, 2, 3], omitKey(SLIDER_EDGES, "axis"));

/** Three links (ground, 1, 2) pinned at (0, 0): ground's two joints coincide. */
export const multiJointStar = (): string =>
  nodeLinkText(
    [0, 1, 2, 3],
    [
      { source: 0, target: 1, pos: [0, 0], input: true },
      { source: 0, target: 2, pos: [0, 0] },
      { source: 1, target: 3, pos: [40, 30] },
      { source: 2, target: 3, pos: [-30, 50] },
    ],
  );

/** Four-bar plus an isolated node 4 and a separate 2-node component (5-6). */
export const disconnected = (): string =>
  nodeLinkText([0, 1, 2, 3, 4, 5, 6], [...FOURBAR_EDGES, { source: 5, target: 6, pos: [300, 0] }]);

/** Four-bar topology with only link lengths (top-level `link_lengths` by node id). */
export const lengthsOnly = (): string =>
  nodeLinkText([0, 1, 2, 3], withoutPos(withoutInput(FOURBAR_EDGES)), {
    extra: {
      link_lengths: { "0": 100, "1": 40, "2": 100.78, "3": 80.6 },
    },
  });

/** Four-bar with string node ids. */
export const stringIds = (): string =>
  nodeLinkText(
    ["n0", "n1", "n2", "n3"],
    FOURBAR_EDGES.map((e) => ({
      ...e,
      source: `n${String(e.source)}`,
      target: `n${String(e.target)}`,
    })),
  );
