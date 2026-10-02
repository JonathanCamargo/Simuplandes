import { describe, it, expect } from "vitest";
import { readGraph } from "../../interchange/readGraph";
import {
  atlasEntries,
  atlasEntryToGraphText,
  atlasFilterOptions,
  filterAtlasEntries,
  thumbnailLayout,
} from "./atlasEntries";

describe("atlasEntries", () => {
  const entries = atlasEntries();

  it("lists the synthetic four-bar first, then the 18 atlas topologies", () => {
    expect(entries).toHaveLength(19);
    expect(entries[0].id).toBe("four-bar");
    expect(entries[0].nLinks).toBe(4);
    expect(entries[0].assortment).toEqual([4, 0, 0, 0]);
    expect(entries[0].assortmentLabel).toBe("4B");
    expect(entries.slice(1, 3).map((e) => e.id)).toEqual(["T6B_S", "T6B_W"]);
    expect(entries.filter((e) => e.nLinks === 8)).toHaveLength(16);
  });

  it("builds assortment labels without zero counts", () => {
    const watt = entries.find((e) => e.id === "T6B_W");
    expect(watt?.assortmentLabel).toBe("4B 2T");
    expect(entries.find((e) => e.id === "T04")?.assortmentLabel).toBe("4B 4T");
    expect(entries.some((e) => /Q/.test(e.assortmentLabel))).toBe(true);
  });

  it("derives filter options from the data", () => {
    const options = atlasFilterOptions(entries);
    expect(options.sizes).toEqual([4, 6, 8]);
    expect(options.classes).toContain("watt");
    expect(options.classes).toContain("stephenson");
    expect(options.classes).toContain("4B 2T");
    expect(options.classes).toEqual([...options.classes].sort());
    expect(new Set(options.classes).size).toBe(options.classes.length);
  });

  it("filters by size and class", () => {
    expect(filterAtlasEntries(entries, { size: "all", cls: "all" })).toHaveLength(19);
    expect(filterAtlasEntries(entries, { size: 8, cls: "all" })).toHaveLength(16);
    expect(filterAtlasEntries(entries, { size: "all", cls: "watt" }).map((e) => e.id)).toEqual([
      "T6B_W",
    ]);
    const eightFourT = filterAtlasEntries(entries, { size: 8, cls: "4B 4T" });
    expect(eightFourT.length).toBeGreaterThan(0);
    expect(eightFourT.every((e) => e.nLinks === 8 && e.assortmentLabel === "4B 4T")).toBe(true);
    expect(filterAtlasEntries(entries, { size: 4, cls: "watt" })).toEqual([]);
  });

  it("lays thumbnails out deterministically on a circle with node 0 top-left", () => {
    const g = entries[0].graph;
    const a = thumbnailLayout(g);
    const b = thumbnailLayout(g);
    expect(a).toEqual(b);
    expect(a.size).toBe(96);
    expect(a.nodes).toHaveLength(4);
    expect(a.edges).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
    expect(a.nodes[0].x).toBeLessThan(48);
    expect(a.nodes[0].y).toBeLessThan(48);
    for (const node of a.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(96);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(96);
    }
    expect(thumbnailLayout(g, 200).size).toBe(200);
    expect(thumbnailLayout({ n: 0, edges: [] }).nodes).toEqual([]);
  });

  it.each(entries.map((e) => [e.id, e] as const))(
    "%s text round-trips through readGraph",
    (_, e) => {
      const text = atlasEntryToGraphText(e);
      const parsed = JSON.parse(text) as { nodes: object[] };
      expect(parsed.nodes[0]).not.toHaveProperty("pos");
      const { graph, items } = readGraph(text);
      expect(items.filter((i) => i.fatal)).toEqual([]);
      expect(graph?.nodes).toHaveLength(e.graph.n);
      expect(graph?.edges).toHaveLength(e.graph.edges.length);
    },
  );
});
