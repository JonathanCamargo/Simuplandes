/**
 * Pure data behind the atlas browser (XCH-08): the entry list (a synthetic
 * four-bar plus every bundled atlas topology), the size/class filters, the
 * node-link thumbnail geometry and the node-link text handed to `planImport`.
 * No React; data-driven from `ATLAS_TOPOLOGIES`, so a future 10-bar atlas
 * shows up with no code change.
 */

import type { IndexGraph } from "../../graph/canonical";
import { ATLAS_TOPOLOGIES } from "../../graph/atlasData";

export interface AtlasEntry {
  /** "four-bar" or the dms id (e.g. "T6B_S", "T15"). */
  id: string;
  nLinks: number;
  name: "watt" | "stephenson" | null;
  /** [binary, ternary, quaternary, pentary] link counts. */
  assortment: readonly [number, number, number, number];
  /** e.g. "4B 2T" (zero counts omitted; letters are language-neutral symbols). */
  assortmentLabel: string;
  /** Node 0 is the ground. */
  graph: IndexGraph;
}

export interface AtlasFilter {
  size: "all" | number;
  /** "all", "watt", "stephenson" or an assortment label. */
  cls: string;
}

export interface AtlasFilterOptions {
  sizes: number[];
  classes: string[];
}

export interface ThumbnailLayout {
  size: number;
  nodes: { x: number; y: number }[];
  edges: [number, number][];
}

const LETTERS = ["B", "T", "Q", "P"] as const;

function assortmentLabel(assortment: readonly number[]): string {
  return assortment
    .map((count, i) => (count > 0 ? `${count}${LETTERS[i]}` : ""))
    .filter((part) => part !== "")
    .join(" ");
}

const FOUR_BAR_ASSORTMENT = [4, 0, 0, 0] as const;

const FOUR_BAR: AtlasEntry = {
  id: "four-bar",
  nLinks: 4,
  name: null,
  assortment: FOUR_BAR_ASSORTMENT,
  assortmentLabel: assortmentLabel(FOUR_BAR_ASSORTMENT),
  graph: {
    n: 4,
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
  },
};

/** The synthetic four-bar first, then every bundled topology in atlas order. */
export function atlasEntries(): AtlasEntry[] {
  return [
    FOUR_BAR,
    ...ATLAS_TOPOLOGIES.map((topology): AtlasEntry => ({
      id: topology.id,
      nLinks: topology.nLinks,
      name: topology.name,
      assortment: topology.assortment,
      assortmentLabel: assortmentLabel(topology.assortment),
      graph: topology.graph,
    })),
  ];
}

/** Distinct link counts and classes (assortment labels plus watt/stephenson), sorted. */
export function atlasFilterOptions(entries: readonly AtlasEntry[]): AtlasFilterOptions {
  const sizes = Array.from(new Set(entries.map((e) => e.nLinks))).sort((a, b) => a - b);
  const classes = new Set<string>();
  for (const entry of entries) {
    classes.add(entry.assortmentLabel);
    if (entry.name !== null) classes.add(entry.name);
  }
  return { sizes, classes: Array.from(classes).sort() };
}

export function filterAtlasEntries(
  entries: readonly AtlasEntry[],
  filter: AtlasFilter,
): AtlasEntry[] {
  return entries.filter(
    (entry) =>
      (filter.size === "all" || entry.nLinks === filter.size) &&
      (filter.cls === "all" || entry.name === filter.cls || entry.assortmentLabel === filter.cls),
  );
}

/** Nodes on a circle inside a padded square box; node 0 at the top-left slot. */
export function thumbnailLayout(graph: IndexGraph, size = 96): ThumbnailLayout {
  const pad = size * 0.14;
  const center = size / 2;
  const radius = size / 2 - pad;
  const nodes = Array.from({ length: graph.n }, (_, i) => {
    const angle = (-3 * Math.PI) / 4 + (2 * Math.PI * i) / Math.max(1, graph.n);
    return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  });
  return { size, nodes, edges: graph.edges.map(([u, v]) => [u, v]) };
}

/** A bare node-link JSON (no positions, no input) that `readGraph` accepts. */
export function atlasEntryToGraphText(entry: AtlasEntry): string {
  return JSON.stringify({
    nodes: Array.from({ length: entry.graph.n }, (_, id) => ({ id })),
    edges: entry.graph.edges.map(([source, target]) => ({ source, target })),
  });
}
