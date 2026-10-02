/**
 * Link assortment (GRF-03): buckets every merged-graph node (ALL nodes,
 * including the ground node) by its `degree`, matching dms's published
 * link-class counts for the 2 six-bar and 16 eight-bar atlas topologies.
 */

import type { LinkGraph } from "./types";

/** `n2`..`n5` count binary/ternary/quaternary/pentary-or-more nodes; `other` counts degree 0/1. */
export interface LinkAssortment {
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  other: number;
}

/** Buckets every node of `g` by degree. `n5` = degree >= 5; `other` = degree 0 or 1. */
export function linkAssortment(g: LinkGraph): LinkAssortment {
  const counts: LinkAssortment = { n2: 0, n3: 0, n4: 0, n5: 0, other: 0 };
  for (const node of g.nodes) {
    switch (node.degree) {
      case 2:
        counts.n2 += 1;
        break;
      case 3:
        counts.n3 += 1;
        break;
      case 4:
        counts.n4 += 1;
        break;
      default:
        if (node.degree >= 5) counts.n5 += 1;
        else counts.other += 1;
    }
  }
  return counts;
}
