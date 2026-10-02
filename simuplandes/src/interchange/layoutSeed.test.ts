import { describe, expect, it } from "vitest";
import {
  JITTER_SIGMA_FRACTION,
  SEED_RADIUS,
  circleMidpointSeed,
  hashLayoutGraph,
  isDegenerateSeed,
  jitteredSeed,
  mulberry32,
} from "./layoutSeed";
import type { LayoutRequest } from "./importReport";

const edge = (u: number, v: number, kind: "R" | "P" = "R") => ({ u, v, kind, axis: null });

const FOURBAR: LayoutRequest = {
  nodeCount: 4,
  edges: [edge(0, 1), edge(0, 3), edge(1, 2), edge(2, 3)],
  inputEdge: 0,
  lengths: null,
  variant: 0,
};

describe("mulberry32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it("differs for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("hashLayoutGraph", () => {
  it("ignores edge order and endpoint order", () => {
    const shuffled: LayoutRequest = {
      ...FOURBAR,
      edges: [edge(3, 2), edge(2, 1), edge(3, 0), edge(1, 0)],
    };
    expect(hashLayoutGraph(shuffled)).toBe(hashLayoutGraph(FOURBAR));
  });
  it("depends on kinds and node count", () => {
    const prismatic: LayoutRequest = {
      ...FOURBAR,
      edges: [edge(0, 1), edge(0, 3, "P"), edge(1, 2), edge(2, 3)],
    };
    expect(hashLayoutGraph(prismatic)).not.toBe(hashLayoutGraph(FOURBAR));
    expect(hashLayoutGraph({ ...FOURBAR, nodeCount: 5 })).not.toBe(hashLayoutGraph(FOURBAR));
  });
});

describe("circleMidpointSeed", () => {
  it("places a joint at the midpoint of its two anchors", () => {
    const pos = circleMidpointSeed(FOURBAR);
    // nodes 0 and 1 at angles 0 and pi/2 on radius 100
    expect(pos[0][0]).toBeCloseTo(50, 9);
    expect(pos[0][1]).toBeCloseTo(50, 9);
    expect(pos).toHaveLength(4);
  });
  it("honours a custom radius and handles an empty node count", () => {
    const pos = circleMidpointSeed(FOURBAR, 10);
    expect(pos[0][0]).toBeCloseTo(5, 9);
    const empty = circleMidpointSeed({ ...FOURBAR, nodeCount: 0, edges: [edge(0, 0)] });
    expect(Number.isFinite(empty[0][0])).toBe(true);
  });
});

describe("jitteredSeed", () => {
  it("try 0 of variant 0 is the plain circle seed", () => {
    expect(jitteredSeed(FOURBAR, 0, 0)).toEqual(circleMidpointSeed(FOURBAR));
  });
  it("is deterministic and differs across tries and variants", () => {
    const a = jitteredSeed(FOURBAR, 0, 3);
    expect(jitteredSeed(FOURBAR, 0, 3)).toEqual(a);
    expect(jitteredSeed(FOURBAR, 0, 4)).not.toEqual(a);
    expect(jitteredSeed(FOURBAR, 1, 3)).not.toEqual(a);
    expect(jitteredSeed(FOURBAR, 1, 0)).not.toEqual(circleMidpointSeed(FOURBAR));
  });
  it("jitter magnitude is on the order of sigma", () => {
    const base = circleMidpointSeed(FOURBAR);
    const jit = jitteredSeed(FOURBAR, 0, 1);
    const d = jit.map((p, i) => Math.hypot(p[0] - base[i][0], p[1] - base[i][1]));
    expect(Math.max(...d)).toBeLessThan(8 * JITTER_SIGMA_FRACTION * SEED_RADIUS);
    expect(Math.max(...d)).toBeGreaterThan(0);
  });
});

describe("isDegenerateSeed", () => {
  it("rejects a coincident pair on one link", () => {
    const pos = circleMidpointSeed(FOURBAR).map((p) => [...p] as [number, number]);
    pos[1] = [pos[0][0] + 1, pos[0][1]]; // both edges of node 0 nearly coincide
    expect(isDegenerateSeed(FOURBAR, pos)).toBe(true);
  });
  it("rejects a collinear ternary link", () => {
    const req: LayoutRequest = {
      nodeCount: 4,
      edges: [edge(0, 1), edge(1, 2), edge(1, 3)],
      inputEdge: null,
      lengths: null,
      variant: 0,
    };
    const pos = [
      [0, 0],
      [50, 0],
      [100, 0],
    ] as const;
    expect(isDegenerateSeed(req, pos)).toBe(true);
  });
  it("accepts a generic triangle link and a generic four-bar seed", () => {
    const req: LayoutRequest = {
      nodeCount: 4,
      edges: [edge(0, 1), edge(1, 2), edge(1, 3)],
      inputEdge: null,
      lengths: null,
      variant: 0,
    };
    const pos = [
      [0, 0],
      [50, 10],
      [30, 90],
    ] as const;
    expect(isDegenerateSeed(req, pos)).toBe(false);
    expect(isDegenerateSeed(FOURBAR, jitteredSeed(FOURBAR, 0, 1))).toBe(false);
  });
});
