import { describe, expect, it } from "vitest";
import { documentFromEdges } from "./__fixtures__/fromEdges";
import { MechanismDocumentSchema } from "../model";
import { ATLAS_TOPOLOGIES } from "./atlasData";
import { GROUND_NODE_ID } from "./types";
import { analyzeDocument, getGraphAnalysis, toIndexGraph } from "./analysis";

const STEPHENSON_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [4, 5],
  [3, 4],
];

describe("analyzeDocument", () => {
  it("identifies a Stephenson six-bar with no issues", () => {
    const { doc } = documentFromEdges(STEPHENSON_EDGES);
    const analysis = analyzeDocument(doc);

    expect(analysis.topology).toEqual({
      kind: "atlas",
      nLinks: 6,
      id: "T6B_S",
      name: "stephenson",
      mapping: expect.any(Array) as number[],
    });
    expect(analysis.mobility.gruebler).toBe(1);
    expect(analysis.baranov).toEqual({ status: "pass" });
    expect(analysis.issueNodeIds.size).toBe(0);
    expect(analysis.issueEdgeIds.size).toBe(0);
    expect(analysis.issueLinkIds.size).toBe(0);
  });

  it("still identifies the Stephenson chain when grounded on a binary link", () => {
    const { doc } = documentFromEdges(STEPHENSON_EDGES, { ground: [1] });
    const analysis = analyzeDocument(doc);
    expect(analysis.topology).toMatchObject({ kind: "atlas", id: "T6B_S", name: "stephenson" });
  });

  it("every bundled atlas topology round-trips through a document to its own id, passes Baranov, and reports its own assortment", () => {
    for (const entry of ATLAS_TOPOLOGIES) {
      const { doc } = documentFromEdges(entry.graph.edges);
      const analysis = analyzeDocument(doc);

      expect(analysis.baranov.status, entry.id).toBe("pass");
      expect(analysis.mobility.gruebler, entry.id).toBe(1);
      expect(
        [
          analysis.assortment.n2,
          analysis.assortment.n3,
          analysis.assortment.n4,
          analysis.assortment.n5,
        ],
        entry.id,
      ).toEqual(entry.assortment);
      expect(analysis.topology, entry.id).toMatchObject({ id: entry.id });
    }
  });

  it("SC-3 golden fixture: a triangle riveted onto a four-bar fails Baranov and reports exactly its 3 offending links/joints; topology is noMatch", () => {
    const { doc, linkIdOf, jointIdOf } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [2, 4],
      [4, 5],
      [5, 2],
    ]);
    const analysis = analyzeDocument(doc);

    expect(analysis.baranov.status).toBe("fail");
    expect(analysis.issueNodeIds).toEqual(new Set([linkIdOf(2), linkIdOf(4), linkIdOf(5)]));
    expect(analysis.issueEdgeIds).toEqual(new Set([jointIdOf(4), jointIdOf(5), jointIdOf(6)]));
    expect(analysis.issueLinkIds).toEqual(new Set([linkIdOf(2), linkIdOf(4), linkIdOf(5)]));
    expect(analysis.topology).toEqual({ kind: "none", reason: "noMatch" });
  });

  it("classifies a slider-crank (one prismatic joint) as fourBar -- joint type ignored at chain level", () => {
    const { doc } = documentFromEdges(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      { prismatic: [3] },
    );
    const analysis = analyzeDocument(doc);
    expect(analysis.topology).toEqual({ kind: "fourBar" });
  });

  it("a ground-loop joint is recorded as a warning; the document is still fully analyzable", () => {
    const { doc } = documentFromEdges(
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [0, 3],
      ],
      { ground: [0, 3] },
    );
    const analysis = analyzeDocument(doc);
    expect(analysis.graph.warnings.some((w) => w.kind === "groundLoop")).toBe(true);
    expect(() => analyzeDocument(doc)).not.toThrow();
    expect(Number.isFinite(analysis.mobility.n)).toBe(true);
  });

  it("toIndexGraph: ground node is index 0, edges map through nodeIds, parallel edges are preserved", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    const analysis = analyzeDocument(doc);
    const { graph: indexGraph, nodeIds } = toIndexGraph(analysis.graph);

    expect(nodeIds[0]).toBe(GROUND_NODE_ID);
    expect(indexGraph.n).toBe(nodeIds.length);
    for (const [a, b] of indexGraph.edges) {
      expect(nodeIds[a]).toBeDefined();
      expect(nodeIds[b]).toBeDefined();
    }
    // Two parallel edges between node 0 and node 1 (ground <-> link1): both preserved.
    const zeroOneCount = indexGraph.edges.filter(
      ([a, b]) =>
        (nodeIds[a] === GROUND_NODE_ID && a !== b) || (nodeIds[b] === GROUND_NODE_ID && a !== b),
    ).length;
    expect(zeroOneCount).toBeGreaterThanOrEqual(2);
    expect(analysis.topology).toEqual({ kind: "none", reason: "notSimple" });
  });

  it("getGraphAnalysis returns the same object for the same document reference, a new one for a new document", () => {
    const { doc: docA } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
    const { doc: docB } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);

    const first = getGraphAnalysis(docA);
    const second = getGraphAnalysis(docA);
    expect(second).toBe(first);

    const third = getGraphAnalysis(docB);
    expect(third).not.toBe(first);
  });

  it("empty document -> empty graph, gruebler null, topology none/empty, baranov pass", () => {
    const doc = MechanismDocumentSchema.parse({ schemaVersion: 1 });
    const analysis = analyzeDocument(doc);
    expect(analysis.graph.nodes).toHaveLength(0);
    expect(analysis.mobility.gruebler).toBeNull();
    expect(analysis.topology).toEqual({ kind: "none", reason: "empty" });
    expect(analysis.baranov).toEqual({ status: "pass" });
  });
});
