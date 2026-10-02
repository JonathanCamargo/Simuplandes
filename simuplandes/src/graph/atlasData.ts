/**
 * Zod-validated eager loader for the bundled topology atlas
 * (`./atlas/*.json`, generated offline by `scripts/export-atlas.py` from
 * dms's `TopologyAtlas` -- see that script's header comment). Uses the same
 * `import.meta.glob` eager-loading pattern as `src/i18n/i18n.ts`, so a
 * future `atlas/tenbar.json` (plan 06-07) is picked up with zero code
 * changes here.
 */

import { z } from "zod";
import type { IndexGraph } from "./canonical";

const AtlasTopologyEntrySchema = z.object({
  id: z.string().min(1),
  name: z.union([z.literal("watt"), z.literal("stephenson"), z.null()]),
  assortment: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  edges: z.array(z.tuple([z.number().int(), z.number().int()])),
});

const AtlasFileSchema = z.object({
  format: z.literal("simuplandes-topology-atlas"),
  version: z.literal(1),
  nLinks: z.number().int().min(4),
  source: z.string(),
  dmsVersion: z.string(),
  networkxVersion: z.string(),
  idScheme: z.string(),
  topologies: z.array(AtlasTopologyEntrySchema),
});

/** One atlas topology, parsed and validated, ready for isomorphism matching. */
export interface AtlasTopology {
  /** dms id, verbatim (e.g. "T6B_S", "T07", later "T10B_047"). */
  id: string;
  nLinks: number;
  /** i18n key suffix, 6-bar only; `null` for every 8-bar/10-bar entry. */
  name: "watt" | "stephenson" | null;
  assortment: readonly [number, number, number, number];
  /** Node 0 is dms's ground node. */
  graph: IndexGraph;
}

/**
 * Validates and converts one atlas JSON file's contents. Throws (with
 * `path` in the message) on: schema mismatch, an edge endpoint outside
 * `0..nLinks-1`, or a duplicate `id` within the same file.
 */
export function parseAtlasFile(path: string, json: unknown): AtlasTopology[] {
  const parsed = AtlasFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid atlas data in "${path}": ${parsed.error.message}`);
  }
  const data = parsed.data;
  const seenIds = new Set<string>();
  const result: AtlasTopology[] = [];
  for (const topo of data.topologies) {
    if (seenIds.has(topo.id)) {
      throw new Error(`Invalid atlas data in "${path}": duplicate topology id "${topo.id}"`);
    }
    seenIds.add(topo.id);
    for (const [u, v] of topo.edges) {
      if (u < 0 || u >= data.nLinks || v < 0 || v >= data.nLinks) {
        throw new Error(
          `Invalid atlas data in "${path}": edge [${u}, ${v}] out of range for nLinks=${data.nLinks} (topology "${topo.id}")`,
        );
      }
    }
    result.push({
      id: topo.id,
      nLinks: data.nLinks,
      name: topo.name,
      assortment: topo.assortment,
      graph: { n: data.nLinks, edges: topo.edges },
    });
  }
  return result;
}

const atlasModules: Record<string, unknown> = import.meta.glob("./atlas/*.json", {
  eager: true,
  import: "default",
});

function loadAllTopologies(): AtlasTopology[] {
  const all: AtlasTopology[] = [];
  for (const [path, json] of Object.entries(atlasModules)) {
    all.push(...parseAtlasFile(path, json));
  }
  all.sort((a, b) => (a.nLinks !== b.nLinks ? a.nLinks - b.nLinks : a.id.localeCompare(b.id)));
  return all;
}

/** Every bundled atlas topology, sorted by `nLinks` then `id`. */
export const ATLAS_TOPOLOGIES: readonly AtlasTopology[] = loadAllTopologies();

/** Distinct `nLinks` values present in the bundled atlas, sorted ascending (e.g. `[6, 8]`). */
export function atlasSizes(): number[] {
  return Array.from(new Set(ATLAS_TOPOLOGIES.map((topology) => topology.nLinks))).sort(
    (a, b) => a - b,
  );
}
