import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGraph, IMPORT_LIMITS } from "./readGraph";
import {
  disconnected,
  duplicateAndSelfLoop,
  lengthsOnly,
  nodeLinkText,
  partialPositions,
  positionedFourBar,
  positionedFourBarLinks,
  stringIds,
  topologyOnlyEightBar,
  FOURBAR_EDGES,
} from "./__fixtures__/importCases";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");
const fixture = (name: string): string => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("readGraph formats", () => {
  it("reads a v1 golden", () => {
    const { graph, items } = readGraph(fixture("fourbar-crank-rocker.graphthe.json"));
    expect(items).toEqual([]);
    expect(graph?.source).toBe("v1");
    expect(graph?.nodes).toHaveLength(4);
    expect(graph?.edges).toHaveLength(4);
    expect(graph?.edges.every((e) => e.pos !== null)).toBe(true);
    expect(graph?.edges.filter((e) => e.input)).toHaveLength(1);
    expect(graph?.units).toBe("mm");
    expect(graph?.name).toBe("fourbar-crank-rocker");
    expect(graph?.nodes[0].linkNames).toEqual(["link-0"]);
    expect(graph?.markers).toHaveLength(1);
    expect(graph?.markers[0]).toMatchObject({ link: 2, name: "marker-0" });
  });

  it("reads the matching v0 .gtm.json with the same nodes and edges", () => {
    const v1 = readGraph(fixture("fourbar-crank-rocker.graphthe.json")).graph!;
    const v0 = readGraph(fixture("fourbar-crank-rocker.gtm.json")).graph!;
    expect(v0.source).toBe("v0");
    expect(v0.nodes.map((n) => n.id)).toEqual(v1.nodes.map((n) => n.id));
    const keyed = (edges: readonly { u: number; v: number; input: boolean }[]): string[] =>
      edges.map((e) => `${e.u}-${e.v}:${e.input}`).sort();
    expect(keyed(v0.edges)).toEqual(keyed(v1.edges));
  });

  it("reads `edges` and `links` node-link dicts identically", () => {
    const a = readGraph(positionedFourBar());
    const b = readGraph(positionedFourBarLinks());
    expect(a.graph?.source).toBe("node-link");
    expect(b.graph).toEqual(a.graph);
    expect(a.graph?.name).toBe("Imported graph");
  });

  it("reads a prismatic edge's type and axis", () => {
    const { graph } = readGraph(fixture("slider-crank.graphthe.json"));
    const edge = graph!.edges.find((e) => e.rawType === "prismatic");
    expect(edge?.axis).toEqual([1, 0]);
  });

  it("reads edges without pos as pos null", () => {
    const { graph } = readGraph(topologyOnlyEightBar());
    expect(graph?.edges).toHaveLength(10);
    expect(graph?.edges.every((e) => e.pos === null)).toBe(true);
    expect(graph?.name).toBe("T15 topology");
  });

  it("reads partially positioned graphs", () => {
    const { graph } = readGraph(partialPositions());
    expect(graph?.edges.filter((e) => e.pos === null)).toHaveLength(1);
  });

  it("tolerates directed/multigraph keys and a nested graph body", () => {
    const text = JSON.stringify({
      directed: false,
      multigraph: false,
      graph: { name: "nested", nodes: [{ id: 0 }, { id: 1 }], links: [{ source: 0, target: 1 }] },
    });
    const { graph } = readGraph(text);
    expect(graph?.edges).toHaveLength(1);
    expect(graph?.name).toBe("Imported graph");
  });

  it("names the graph from graph.graph.name", () => {
    const text = JSON.stringify({
      nodes: [{ id: 0 }, { id: 1 }],
      edges: [{ source: 0, target: 1 }],
      graph: { graph: { name: "from-inner" } },
    });
    expect(readGraph(text).graph?.name).toBe("from-inner");
  });
});

describe("readGraph lengths", () => {
  it("reads node length and link_length attributes", () => {
    const text = nodeLinkText(
      [0, 1, 2],
      [
        { source: 0, target: 1 },
        { source: 1, target: 2 },
      ],
      {
        nodeExtras: { "1": { length: 5 }, "2": { link_length: 7 }, "0": { length: -1 } },
      },
    );
    const { graph } = readGraph(text);
    expect(graph?.nodes.map((n) => n.length)).toEqual([null, 5, 7]);
  });

  it("reads a top-level link_lengths object keyed by original id", () => {
    const { graph } = readGraph(lengthsOnly());
    expect(graph?.nodes.map((n) => n.length)).toEqual([100, 40, 100.78, 80.6]);
  });

  it("reads a top-level link_lengths array by node index", () => {
    const text = nodeLinkText([0, 1], [{ source: 0, target: 1 }], {
      extra: { link_lengths: [3, "x"] },
    });
    expect(readGraph(text).graph?.nodes.map((n) => n.length)).toEqual([3, null]);
  });
});

describe("readGraph normalization", () => {
  it("maps non-contiguous numeric ids ascending, keeping originals", () => {
    const text = nodeLinkText(
      [10, 2, 7],
      [
        { source: 10, target: 2, pos: [0, 0] },
        { source: 7, target: 2, pos: [1, 1] },
      ],
    );
    const { graph } = readGraph(text);
    expect(graph?.nodes.map((n) => [n.id, n.originalId])).toEqual([
      [0, 2],
      [1, 7],
      [2, 10],
    ]);
    expect(graph?.edges.map((e) => [e.u, e.v])).toEqual([
      [0, 2],
      [0, 1],
    ]);
  });

  it("sorts string ids as strings", () => {
    const { graph } = readGraph(stringIds());
    expect(graph?.nodes.map((n) => n.originalId)).toEqual(["n0", "n1", "n2", "n3"]);
    expect(graph?.edges[0]).toMatchObject({ u: 0, v: 1 });
  });

  it("sorts mixed ids by their string value", () => {
    const text = nodeLinkText([2, "a", 1], [{ source: 1, target: "a" }]);
    expect(readGraph(text).graph?.nodes.map((n) => n.originalId)).toEqual([1, 2, "a"]);
  });

  it("drops self-loops and duplicate edges with an active drop fix", () => {
    const { graph, items } = readGraph(duplicateAndSelfLoop());
    expect(graph?.edges).toHaveLength(4);
    const loop = items.find((i) => i.code === "self-loop");
    const dup = items.find((i) => i.code === "duplicate-edge");
    expect(loop).toMatchObject({ severity: "warning", activeFixId: "drop", edgeKeys: ["1-1"] });
    expect(dup).toMatchObject({ severity: "warning", activeFixId: "drop", edgeKeys: ["1-2"] });
    expect(loop?.fixes.map((f) => f.id)).toEqual(["drop"]);
  });

  it("keeps an isolated node and extra components (planImport decides)", () => {
    const { graph } = readGraph(disconnected());
    expect(graph?.nodes).toHaveLength(7);
    expect(graph?.edges).toHaveLength(5);
  });

  it("maps markers to normalized nodes and skips invalid ones", () => {
    const text = JSON.stringify({
      nodes: [{ id: 5 }, { id: 9 }],
      edges: [{ source: 5, target: 9 }],
      markers: [
        { link: 9, pos: [1, 2], name: "m" },
        { link: 9, pos: [1, 2] },
        { link: 77, pos: [1, 2] },
        { link: 9, pos: [1] },
        { link: {}, pos: [1, 2] },
        "junk",
      ],
    });
    const { graph } = readGraph(text);
    expect(graph?.markers).toEqual([
      { link: 1, pos: [1, 2], name: "m" },
      { link: 1, pos: [1, 2], name: null },
    ]);
  });

  it("ignores a malformed markers value and malformed link_names", () => {
    const text = JSON.stringify({
      nodes: [
        { id: 0, link_names: [1] },
        { id: 1, link_names: ["a", "b"] },
      ],
      edges: [{ source: 0, target: 1, pos: [1, "x"], axis: [0, 0, 0], type: 5, input: "yes" }],
      markers: "nope",
    });
    const { graph } = readGraph(text);
    expect(graph?.markers).toEqual([]);
    expect(graph?.nodes.map((n) => n.linkNames)).toEqual([null, ["a", "b"]]);
    expect(graph?.edges[0]).toMatchObject({ pos: null, axis: null, rawType: null, input: false });
  });

  it("keeps the first of duplicate node ids", () => {
    const text = JSON.stringify({
      nodes: [{ id: 0, length: 3 }, { id: 0, length: 9 }, { id: 1 }],
      edges: [{ source: 0, target: 1 }],
    });
    const { graph } = readGraph(text);
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.nodes[0].length).toBe(3);
  });

  it("lower-cases the raw joint type", () => {
    const text = nodeLinkText([0, 1], [{ source: 0, target: 1, type: "Prismatic" }]);
    expect(readGraph(text).graph?.edges[0].rawType).toBe("prismatic");
  });
});

describe("readGraph fatal items", () => {
  const fatalCode = (text: string, limits?: Partial<typeof IMPORT_LIMITS>): string => {
    const { graph, items } = readGraph(text, limits);
    expect(graph).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].fatal).toBe(true);
    expect(items[0].severity).toBe("error");
    return items[0].code;
  };

  it("reports garbage text as unparseable", () => {
    expect(fatalCode("not json {")).toBe("unparseable");
    expect(fatalCode("")).toBe("unparseable");
  });

  it("reports unrecognised JSON as unknown-format", () => {
    expect(fatalCode("[1,2]")).toBe("unknown-format");
    expect(fatalCode("42")).toBe("unknown-format");
    expect(fatalCode("null")).toBe("unknown-format");
    expect(fatalCode('{"hello": 1}')).toBe("unknown-format");
    expect(fatalCode('{"nodes": [{"x": 1}], "edges": []}')).toBe("unknown-format");
    expect(fatalCode('{"format": "simuplandes-graphthe-export", "version": 2}')).toBe(
      "unknown-format",
    );
    expect(fatalCode('{"format": "simuplandes-parity-fixture", "version": 1}')).toBe(
      "unknown-format",
    );
  });

  it("reports an edge to an unknown node as unknown-format", () => {
    expect(fatalCode(nodeLinkText([0, 1], [{ source: 0, target: 5 }]))).toBe("unknown-format");
  });

  it("reports oversize input as too-large with params", () => {
    const { items } = readGraph(positionedFourBar(), { maxBytes: 10 });
    expect(items[0]).toMatchObject({ code: "too-large", params: { what: "bytes", limit: 10 } });
    const nodes = readGraph(positionedFourBar(), { maxNodes: 3 });
    expect(nodes.items[0]).toMatchObject({
      code: "too-large",
      params: { what: "nodes", limit: 3, actual: 4 },
    });
  });

  it("enforces the default 64-node cap", () => {
    const ids = Array.from({ length: 65 }, (_, i) => i);
    const edges = ids.slice(1).map((i) => ({ source: 0, target: i }));
    expect(fatalCode(nodeLinkText(ids, edges))).toBe("too-large");
  });

  it("reports zero nodes or zero edges as empty-graph", () => {
    expect(fatalCode('{"nodes": [], "edges": []}')).toBe("empty-graph");
    expect(fatalCode(nodeLinkText([0, 1], []))).toBe("empty-graph");
  });

  it("reports a graph that loses every edge to self-loops as empty-graph", () => {
    expect(fatalCode(nodeLinkText([0], [{ source: 0, target: 0 }]))).toBe("empty-graph");
  });
});

describe("readGraph units", () => {
  it("keeps a known units label silently", () => {
    const text = nodeLinkText([0, 1], [{ source: 0, target: 1 }], { extra: { units: "m" } });
    const { graph, items } = readGraph(text);
    expect(graph?.units).toBe("m");
    expect(items).toEqual([]);
  });

  it("keeps an unknown units label with a units-unknown info item", () => {
    const text = nodeLinkText([0, 1], [{ source: 0, target: 1 }], { extra: { units: "furlong" } });
    const { graph, items } = readGraph(text);
    expect(graph?.units).toBe("furlong");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      code: "units-unknown",
      severity: "info",
      fatal: false,
      params: { units: "furlong" },
    });
  });

  it("has null units when absent", () => {
    expect(readGraph(nodeLinkText([0, 1], FOURBAR_EDGES.slice(0, 1))).graph?.units).toBeNull();
  });
});
