import { describe, expect, it } from "vitest";
import {
  bulgeThrough,
  convertEdge,
  edgeMidpoint,
  edgePoint,
  flattenBar,
  flattenEdge,
  flattenOutline,
  remapEdges,
  splitEdge,
} from "./shapeGeometry";
import { computedMassProperties } from "./massProperties";
import { MAX_BULGE, type Edge, type Link } from "./schema";
import type { Vec2Tuple } from "./vec";

const A: Vec2Tuple = [0, 0];
const B: Vec2Tuple = [2, 0];

function dist(p: Vec2Tuple, q: Vec2Tuple): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

describe("arcs", () => {
  it("a bulge of 1 is a semicircle bowing left of start -> end", () => {
    const arc: Edge = { kind: "arc", bulge: 1 };
    const apex = edgeMidpoint(A, B, arc);
    expect(apex[0]).toBeCloseTo(1);
    expect(apex[1]).toBeCloseTo(1);
    const right = edgeMidpoint(A, B, { kind: "arc", bulge: -1 });
    expect(right[1]).toBeCloseTo(-1);
  });

  it("starts and ends on its vertices, every point on one circle", () => {
    const arc: Edge = { kind: "arc", bulge: 0.6 };
    expect(dist(edgePoint(A, B, arc, 0), A)).toBeLessThan(1e-12);
    expect(dist(edgePoint(A, B, arc, 1), B)).toBeLessThan(1e-12);
    // Radius from chord 2 and bulge b: c(1 + b^2) / (4|b|).
    const radius = (2 * (1 + 0.36)) / (4 * 0.6);
    const sagitta = 0.6;
    const center: Vec2Tuple = [1, sagitta - radius];
    for (const p of flattenEdge(A, B, arc)) expect(dist(p, center)).toBeCloseTo(radius, 10);
  });

  it("bulgeThrough inverts the apex, clamped to MAX_BULGE", () => {
    const arc: Edge = { kind: "arc", bulge: -0.75 };
    expect(bulgeThrough(A, B, edgeMidpoint(A, B, arc))).toBeCloseTo(-0.75);
    expect(bulgeThrough(A, B, [1, 100])).toBe(MAX_BULGE);
    expect(bulgeThrough(A, A, [1, 1])).toBe(0);
  });

  it("flattens finely enough: a half-disc plate's area and centroid are within 0.1% of exact", () => {
    // Diameter A -> B, then two quarter arcs over the top through (1, 1).
    // Going B -> (1, 1) -> A the outside of the disc is on the right, so
    // both arcs bow right: negative bulge.
    const quarter = -Math.tan(Math.PI / 8);
    const halfDisc: Link = {
      id: "p",
      name: "",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: {
        kind: "plate",
        outline: [A, B, [1, 1]],
        edges: [{ kind: "line" }, { kind: "arc", bulge: quarter }, { kind: "arc", bulge: quarter }],
      },
      sites: [],
    };
    const doc = {
      units: { length: "m" as const },
      dynamics: { gravity: [0, -9.81] as [number, number], barDensity: 1, plateDensity: 1 },
    };
    const { mass, com } = computedMassProperties(halfDisc, doc);
    expect(Math.abs(mass - Math.PI / 2) / (Math.PI / 2)).toBeLessThan(1e-3);
    // A half disc's centroid is 4r / (3 pi) above its diameter.
    const centroid = 4 / (3 * Math.PI);
    expect(Math.abs(com[1] - centroid) / centroid).toBeLessThan(1e-3);
    expect(com[0]).toBeCloseTo(1);
  });
});

describe("Bézier curves", () => {
  it("control points are offsets from their own vertex", () => {
    const curve: Edge = { kind: "bezier", out: [0, 1], in: [0, 1] };
    const mid = edgeMidpoint(A, B, curve);
    expect(mid).toEqual([1, 0.75]);
    expect(edgePoint(A, B, curve, 0)).toEqual(A);
    expect(edgePoint(A, B, curve, 1)).toEqual(B);
  });

  it("convertEdge turns a quarter arc into a curve within 0.03% of its radius", () => {
    // A 90-degree arc over the chord A -> B: radius sqrt(2) about (1, -1).
    const arc: Edge = { kind: "arc", bulge: Math.tan(Math.PI / 8) };
    const curve = convertEdge(A, B, arc, "bezier");
    expect(curve.kind).toBe("bezier");
    const center: Vec2Tuple = [1, -1];
    const radius = Math.SQRT2;
    for (let i = 0; i <= 20; i++) {
      const error = Math.abs(dist(edgePoint(A, B, curve, i / 20), center) - radius) / radius;
      expect(error).toBeLessThan(3e-4);
    }
  });

  it("convertEdge back to an arc keeps the apex; a line becomes a default arc", () => {
    const curve: Edge = { kind: "bezier", out: [0, 1], in: [0, 1] };
    const arc = convertEdge(A, B, curve, "arc");
    expect(arc.kind === "arc" && arc.bulge).toBeCloseTo(0.75);
    const fresh = convertEdge(A, B, { kind: "line" }, "arc");
    expect(fresh.kind === "arc" && fresh.bulge).toBeGreaterThan(0);
    expect(convertEdge(A, B, arc, "line")).toEqual({ kind: "line" });
  });
});

describe("splitEdge", () => {
  it("splits an arc at its apex into two arcs tracing the same circle", () => {
    const arc: Edge = { kind: "arc", bulge: 0.8 };
    const { mid, first, second } = splitEdge(A, B, arc);
    expect(dist(mid, edgeMidpoint(A, B, arc))).toBeLessThan(1e-12);
    // Quarter points of the original are the halves' midpoints.
    expect(dist(edgeMidpoint(A, mid, first), edgePoint(A, B, arc, 0.25))).toBeLessThan(1e-9);
    expect(dist(edgeMidpoint(mid, B, second), edgePoint(A, B, arc, 0.75))).toBeLessThan(1e-9);
  });

  it("splits a curve with de Casteljau: both halves trace the original", () => {
    const curve: Edge = { kind: "bezier", out: [0.3, 1.2], in: [-0.5, -0.4] };
    const { mid, first, second } = splitEdge(A, B, curve);
    for (const t of [0.1, 0.3, 0.45]) {
      expect(dist(edgePoint(A, mid, first, t * 2), edgePoint(A, B, curve, t))).toBeLessThan(1e-12);
      expect(dist(edgePoint(mid, B, second, t * 2), edgePoint(A, B, curve, 0.5 + t))).toBeLessThan(
        1e-12,
      );
    }
  });
});

describe("flattening and remapping", () => {
  it("flattenOutline starts at the first vertex, visits every vertex, and leaves the closing to the caller", () => {
    const outline: Vec2Tuple[] = [A, B, [1, 2]];
    expect(flattenOutline(outline)).toEqual(outline);
    const curved = flattenOutline(outline, [
      { kind: "arc", bulge: -0.5 },
      { kind: "line" },
      { kind: "line" },
    ]);
    expect(curved[0]).toEqual(A);
    expect(curved).toContainEqual(B);
    expect(curved.length).toBeGreaterThan(3);
  });

  it("flattenBar follows the bar's path, curves included", () => {
    const link = {
      shape: {
        kind: "bar" as const,
        path: ["s0", "s1"],
        edges: [{ kind: "arc" as const, bulge: 1 }],
      },
      sites: [
        { id: "s0", name: "", local: A },
        { id: "s1", name: "", local: B },
        { id: "spring", name: "", local: [5, 5] as Vec2Tuple },
      ],
    };
    const points = flattenBar(link);
    expect(points[0]).toEqual(A);
    expect(points[points.length - 1]).toEqual(B);
    expect(points.some((p) => p[1] > 0.99)).toBe(true);
    expect(points).not.toContainEqual([5, 5]);
  });

  it("remapEdges keeps curves between surviving neighbors only", () => {
    const arc: Edge = { kind: "arc", bulge: 0.5 };
    const line: Edge = { kind: "line" };
    // A closed square losing vertex 2: edges 0 and 3 survive, 1-2-3 collapses to a line.
    expect(remapEdges([arc, arc, arc, arc], 4, [0, 1, 3], true)).toEqual([arc, line, arc]);
    // An open path losing its middle vertex.
    expect(remapEdges([arc, arc], 3, [0, 2], false)).toEqual([line]);
    // A brand-new vertex (-1) is joined by lines.
    expect(remapEdges([arc, arc, arc], 3, [0, -1, 1, 2], true)).toEqual([line, line, arc, arc]);
  });
});
