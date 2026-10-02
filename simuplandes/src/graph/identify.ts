/**
 * `identifyTopology`: the single entry point for GRF-04. Classifies an
 * `IndexGraph` at the CHAIN level -- the ground label and joint type (R/P)
 * are both ignored, so a Stephenson chain grounded on a binary link
 * (Stephenson III) is still identified as the Stephenson chain.
 */

import { ATLAS_TOPOLOGIES, atlasSizes, type AtlasTopology } from "./atlasData";
import {
  degreeSequence,
  invariantKey,
  isConnected,
  isSimpleGraph,
  type IndexGraph,
} from "./canonical";
import { findIsomorphism } from "./isomorphism";

export type TopologyMatch =
  | { kind: "fourBar" }
  | {
      kind: "atlas";
      nLinks: number;
      id: string;
      name: "watt" | "stephenson" | null;
      mapping: number[];
    }
  | { kind: "none"; reason: "empty" | "notSimple" | "disconnected" | "noAtlasForSize" | "noMatch" };

let atlasBucketsBySize: Map<number, Map<string, AtlasTopology[]>> | null = null;

function getAtlasBuckets(): Map<number, Map<string, AtlasTopology[]>> {
  if (atlasBucketsBySize) return atlasBucketsBySize;
  const bySize = new Map<number, Map<string, AtlasTopology[]>>();
  for (const topology of ATLAS_TOPOLOGIES) {
    let byKey = bySize.get(topology.nLinks);
    if (!byKey) {
      byKey = new Map<string, AtlasTopology[]>();
      bySize.set(topology.nLinks, byKey);
    }
    const key = invariantKey(topology.graph);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(topology);
    else byKey.set(key, [topology]);
  }
  atlasBucketsBySize = bySize;
  return bySize;
}

function isFourBar(g: IndexGraph): boolean {
  if (g.n !== 4 || g.edges.length !== 4) return false;
  return degreeSequence(g).every((degree) => degree === 2);
}

/** Classifies `g` as four-bar / a specific atlas topology / no match with a reason. */
export function identifyTopology(g: IndexGraph): TopologyMatch {
  if (g.n === 0) return { kind: "none", reason: "empty" };
  if (!isSimpleGraph(g)) return { kind: "none", reason: "notSimple" };
  if (!isConnected(g)) return { kind: "none", reason: "disconnected" };
  if (isFourBar(g)) return { kind: "fourBar" };

  if (!atlasSizes().includes(g.n)) return { kind: "none", reason: "noAtlasForSize" };

  const buckets = getAtlasBuckets().get(g.n);
  const candidates = buckets?.get(invariantKey(g)) ?? [];
  for (const candidate of candidates) {
    const mapping = findIsomorphism(g, candidate.graph);
    if (mapping) {
      return {
        kind: "atlas",
        nLinks: candidate.nLinks,
        id: candidate.id,
        name: candidate.name,
        mapping,
      };
    }
  }
  return { kind: "none", reason: "noMatch" };
}
