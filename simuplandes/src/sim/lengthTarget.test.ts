// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LayoutRequest } from "../interchange/importReport";
import { jitteredSeed } from "../interchange/layoutSeed";
import { fitLengths } from "./lengthTarget";

const edge = (u: number, v: number) => ({ u, v, kind: "R" as const, axis: null });

const FOURBAR: LayoutRequest = {
  nodeCount: 4,
  edges: [edge(0, 1), edge(0, 3), edge(1, 2), edge(2, 3)],
  inputEdge: 0,
  lengths: [100, 40, 100.78, 80.6],
  variant: 0,
};

function d(p: readonly (readonly [number, number])[], a: number, b: number): number {
  return Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);
}

describe("fitLengths", () => {
  it("meets every binary link length on the lengths-only four-bar", () => {
    const fit = fitLengths(FOURBAR, jitteredSeed(FOURBAR, 0, 1));
    expect(fit.feasible).toBe(true);
    const tol = 1e-6 * 100.78;
    // node 0: edges 0,1; node 1: edges 0,2; node 2: edges 2,3; node 3: edges 1,3
    expect(Math.abs(d(fit.positions, 0, 1) - 100)).toBeLessThan(tol);
    expect(Math.abs(d(fit.positions, 0, 2) - 40)).toBeLessThan(tol);
    expect(Math.abs(d(fit.positions, 2, 3) - 100.78)).toBeLessThan(tol);
    expect(Math.abs(d(fit.positions, 1, 3) - 80.6)).toBeLessThan(tol);
    expect(fit.residual).toBeLessThan(tol);
  });

  it("reports infeasible lengths (longest > sum of the others)", () => {
    const req: LayoutRequest = { ...FOURBAR, lengths: [100, 10, 10, 10] };
    const fit = fitLengths(req, jitteredSeed(req, 0, 1));
    expect(fit.feasible).toBe(false);
    expect(fit.residual).toBeGreaterThan(1e-6 * 100);
  });

  it("pins the farthest pair of a ternary link and bounds the other pairs", () => {
    // node 1 is ternary (edges 0, 2, 3); node 0 ground; everything else binary.
    const req: LayoutRequest = {
      nodeCount: 4,
      edges: [edge(0, 1), edge(1, 2), edge(1, 3), edge(0, 2), edge(0, 3)],
      inputEdge: 0,
      lengths: [null, 100, null, null],
      variant: 0,
    };
    const seed = jitteredSeed(req, 0, 1);
    const fit = fitLengths(req, seed);
    expect(fit.feasible).toBe(true);
    const dists = [d(fit.positions, 0, 1), d(fit.positions, 0, 2), d(fit.positions, 1, 2)];
    const tol = 1e-6 * 100;
    expect(Math.max(...dists)).toBeGreaterThan(100 - tol);
    for (const v of dists) expect(v).toBeLessThanOrEqual(100 + tol);
  });

  it("imposes no constraint for null lengths and leaves the seed untouched", () => {
    const req: LayoutRequest = { ...FOURBAR, lengths: [null, null, null, null] };
    const seed = jitteredSeed(req, 0, 2);
    const fit = fitLengths(req, seed);
    expect(fit.feasible).toBe(true);
    expect(fit.residual).toBe(0);
    expect(fit.positions).toEqual(seed);
  });

  it("ignores a link with fewer than two joints and a missing lengths array", () => {
    const short: LayoutRequest = {
      ...FOURBAR,
      nodeCount: 5,
      lengths: [100, 40, 100.78, 80.6, 50],
    };
    expect(fitLengths(short, jitteredSeed(short, 0, 1)).feasible).toBe(true);
    expect(fitLengths({ ...FOURBAR, lengths: null }, jitteredSeed(FOURBAR, 0, 1)).residual).toBe(0);
  });

  it("returns immediately when the seed already satisfies the lengths", () => {
    const first = fitLengths(FOURBAR, jitteredSeed(FOURBAR, 0, 1));
    const again = fitLengths(FOURBAR, first.positions);
    expect(again.feasible).toBe(true);
    expect(again.residual).toBeLessThan(1e-8);
  });
});
