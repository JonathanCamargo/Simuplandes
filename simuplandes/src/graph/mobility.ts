/**
 * Gruebler's planar mobility formula on a merged `LinkGraph`: same formula
 * as `src/kinematics/mobility.ts::grueblerMobility`, recomputed on the graph
 * because of the ESLint seam (`src/graph/**` may not import
 * `src/kinematics`); parity between the two independent computations is
 * asserted in `src/sim/graphParity.test.ts`.
 */

import type { LinkGraph } from "./types";

/** `n` (merged node count), `j` (ALL document joints) and Gruebler `F`, or `null` with no moving links. */
export interface GraphMobility {
  n: number;
  j: number;
  gruebler: number | null;
}

/** `F = 3*(n-1) - 2*j`. `null` iff the graph has no moving node (only ground, or empty). */
export function graphMobility(g: LinkGraph): GraphMobility {
  const n = g.nodes.length;
  const j = g.jointCount;
  const hasMovingNode = g.nodes.some((node) => !node.isGround);
  const gruebler = hasMovingNode ? 3 * (n - 1) - 2 * j : null;
  return { n, j, gruebler };
}
