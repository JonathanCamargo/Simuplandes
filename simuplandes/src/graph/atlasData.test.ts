import { describe, expect, it } from "vitest";
import { ATLAS_TOPOLOGIES, atlasSizes, parseAtlasFile } from "./atlasData";
import { degreeSequence, isConnected, isSimpleGraph } from "./canonical";

const EXPECTED_COUNTS: Record<number, number> = { 6: 2, 8: 16, 10: 230 };

function degreeToLinkType(degree: number): "binary" | "ternary" | "quaternary" | "pentary" {
  switch (degree) {
    case 2:
      return "binary";
    case 3:
      return "ternary";
    case 4:
      return "quaternary";
    default:
      return "pentary";
  }
}

describe("atlasData", () => {
  it("includes sizes 6 and 8", () => {
    expect(atlasSizes()).toEqual(expect.arrayContaining([6, 8]));
  });

  it("has the expected topology count for every size present", () => {
    for (const size of atlasSizes()) {
      const expected = EXPECTED_COUNTS[size];
      if (expected === undefined) continue; // future sizes not yet given an expected count
      const count = ATLAS_TOPOLOGIES.filter((t) => t.nLinks === size).length;
      expect(count).toBe(expected);
    }
  });

  it("every entry is a simple, connected graph satisfying Gruebler F = 1", () => {
    for (const topology of ATLAS_TOPOLOGIES) {
      expect(topology.graph.n).toBe(topology.nLinks);
      const m = topology.graph.edges.length;
      expect(m).toBe((3 * (topology.nLinks - 1) - 1) / 2);
      expect(3 * (topology.nLinks - 1) - 2 * m).toBe(1);
      expect(isSimpleGraph(topology.graph)).toBe(true);
      expect(isConnected(topology.graph)).toBe(true);
    }
  });

  it("degree-derived assortment matches the recorded assortment for every entry", () => {
    for (const topology of ATLAS_TOPOLOGIES) {
      const counts: Record<"binary" | "ternary" | "quaternary" | "pentary", number> = {
        binary: 0,
        ternary: 0,
        quaternary: 0,
        pentary: 0,
      };
      for (const degree of degreeSequence(topology.graph)) {
        counts[degreeToLinkType(degree)] += 1;
      }
      expect([counts.binary, counts.ternary, counts.quaternary, counts.pentary]).toEqual([
        ...topology.assortment,
      ]);
    }
  });

  it("ids are unique across the whole atlas", () => {
    const ids = ATLAS_TOPOLOGIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("6-bar names are exactly Watt and Stephenson", () => {
    const sixBar = ATLAS_TOPOLOGIES.filter((t) => t.nLinks === 6);
    const namesById = Object.fromEntries(sixBar.map((t) => [t.id, t.name]));
    expect(namesById).toEqual({ T6B_W: "watt", T6B_S: "stephenson" });
  });

  it("8-bar class distribution matches (4,4,0,0)x9, (5,2,1,0)x5, (6,0,2,0)x2", () => {
    const eightBar = ATLAS_TOPOLOGIES.filter((t) => t.nLinks === 8);
    const dist = new Map<string, number>();
    for (const topology of eightBar) {
      const key = topology.assortment.join(",");
      dist.set(key, (dist.get(key) ?? 0) + 1);
    }
    expect(dist.get("4,4,0,0")).toBe(9);
    expect(dist.get("5,2,1,0")).toBe(5);
    expect(dist.get("6,0,2,0")).toBe(2);
  });

  it("8-bar entries have name: null", () => {
    for (const topology of ATLAS_TOPOLOGIES.filter((t) => t.nLinks === 8)) {
      expect(topology.name).toBeNull();
    }
  });
});

describe("parseAtlasFile", () => {
  const validFile = {
    format: "simuplandes-topology-atlas",
    version: 1,
    nLinks: 4,
    source: "dms.mechanisms.atlas.TopologyAtlas",
    dmsVersion: "unknown",
    networkxVersion: "3.6.1",
    idScheme: "dms topology_id, verbatim",
    topologies: [
      {
        id: "TX",
        name: null,
        assortment: [4, 0, 0, 0],
        edges: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
        ],
      },
    ],
  };

  it("accepts a well-formed file", () => {
    const result = parseAtlasFile("test.json", validFile);
    expect(result).toHaveLength(1);
    expect(result[0].graph).toEqual({
      n: 4,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
    });
  });

  it("rejects a wrong format string, including the path", () => {
    expect(() => parseAtlasFile("bad.json", { ...validFile, format: "wrong" })).toThrow(
      /Invalid atlas data in "bad\.json"/,
    );
  });

  it("rejects an out-of-range edge endpoint, including the path", () => {
    const bad = {
      ...validFile,
      topologies: [{ ...validFile.topologies[0], edges: [[0, 9]] }],
    };
    expect(() => parseAtlasFile("range.json", bad)).toThrow(/Invalid atlas data in "range\.json"/);
    expect(() => parseAtlasFile("range.json", bad)).toThrow(/out of range/);
  });

  it("rejects duplicate ids within the file, including the path", () => {
    const bad = {
      ...validFile,
      topologies: [validFile.topologies[0], validFile.topologies[0]],
    };
    expect(() => parseAtlasFile("dup.json", bad)).toThrow(/Invalid atlas data in "dup\.json"/);
    expect(() => parseAtlasFile("dup.json", bad)).toThrow(/duplicate topology id/);
  });
});
