/**
 * Public barrel for `src/graph`: the merged link-graph contract, its
 * topology-only structural checks (GRF-01/GRF-03), the topology atlas and
 * isomorphism matching (GRF-04), and the layouts + one-call aggregator the
 * graph panel/canvas consume (GRF-05, 06-04). The `__fixtures__/fromEdges`
 * builder is test/E2E-only and is intentionally NOT re-exported here.
 */

export * from "./types";
export * from "./fromDocument";
export * from "./mobility";
export * from "./linkAssortment";
export * from "./baranov";
export * from "./canonical";
export * from "./isomorphism";
export * from "./atlasData";
export * from "./identify";
export * from "./layouts";
export * from "./analysis";
