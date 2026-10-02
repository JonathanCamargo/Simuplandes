// @vitest-environment node
/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importGraphthe } from "../interchange/importGraphthe";
import { parseGraphtheText } from "../interchange/graphtheSchema";
import type { LayoutRequest, Vec2Tuple } from "../interchange/importReport";
import { circleMidpointSeed } from "../interchange/layoutSeed";
import { compileSystem, referenceState } from "../kinematics";
import { FOURBAR_EDGES, SLIDER_EDGES } from "../interchange/__fixtures__/importCases";
import { conventionInputEdge, inputRange, measureCandidate } from "./mobilityRange";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");
const DEG = Math.PI / 180;

function goldenSystem(name: string) {
  const env = parseGraphtheText(readFileSync(join(FIXTURES_DIR, `${name}.graphthe.json`), "utf8"));
  return compileSystem(importGraphthe(env, { anchoredPoses: true }));
}

const edge = (u: number, v: number, kind: "R" | "P" = "R") => ({ u, v, kind, axis: null });

function requestOf(
  specs: readonly { source: number | string; target: number | string; type?: string }[],
  nodeCount: number,
  inputEdge: number | null,
): LayoutRequest {
  return {
    nodeCount,
    edges: specs.map((e) =>
      e.type === "prismatic"
        ? { u: Number(e.source), v: Number(e.target), kind: "P" as const, axis: [1, 0] as const }
        : edge(Number(e.source), Number(e.target)),
    ),
    inputEdge,
    lengths: null,
    variant: 0,
  };
}

describe("inputRange", () => {
  it("reaches the goal on a crank-rocker", () => {
    const system = goldenSystem("fourbar-crank-rocker");
    const range = inputRange(system, referenceState(system), 0, 75 * DEG);
    expect(range).toBeGreaterThanOrEqual(75 * DEG);
  });

  it("stays below 60 degrees on stephenson-ii (lock-up partial step counted)", () => {
    const system = goldenSystem("stephenson-ii");
    const range = inputRange(system, referenceState(system), 0, 75 * DEG);
    expect(range).toBeGreaterThan(0);
    expect(range / DEG).toBeLessThan(60);
  });
});

describe("conventionInputEdge", () => {
  it("prefers the first degree-2 neighbour of node 0, else the first neighbour", () => {
    // node 1 has degree 3, node 2 has degree 2 -> edge 1 (0-2)
    const pref = requestOf(
      [
        { source: 0, target: 1 },
        { source: 0, target: 2 },
        { source: 1, target: 3 },
        { source: 1, target: 2 },
      ],
      4,
      null,
    );
    expect(conventionInputEdge(pref)).toBe(1);
    // node 1 degree 3, node 2 degree 3 -> no degree-2 neighbour: first (edge 0)
    const first = requestOf(
      [
        { source: 0, target: 1 },
        { source: 0, target: 2 },
        { source: 1, target: 3 },
        { source: 2, target: 3 },
        { source: 1, target: 2 },
      ],
      4,
      null,
    );
    expect(conventionInputEdge(first)).toBe(0);
  });

  it("returns null without a ground edge", () => {
    expect(conventionInputEdge(requestOf([{ source: 1, target: 2 }], 3, null))).toBeNull();
  });
});

describe("measureCandidate", () => {
  const fourbar = requestOf(FOURBAR_EDGES, 4, 0);
  const positions = FOURBAR_EDGES.map((e) => e.pos as Vec2Tuple);

  it("measures a crank-rocker drawing at the goal", () => {
    const m = measureCandidate(fourbar, positions);
    expect(m.gruebler).toBe(1);
    expect(m.rangeDeg).toBeGreaterThanOrEqual(75);
  });

  it("falls back to the convention input edge when inputEdge is null", () => {
    const m = measureCandidate({ ...fourbar, inputEdge: null }, positions);
    expect(m.rangeDeg).toBeGreaterThan(0);
  });

  it("short-circuits a non-1-DOF topology with range 0", () => {
    const five = requestOf(
      [
        { source: 0, target: 1 },
        { source: 1, target: 2 },
        { source: 2, target: 3 },
        { source: 3, target: 4 },
        { source: 4, target: 0 },
      ],
      5,
      0,
    );
    const m = measureCandidate(five, circleMidpointSeed(five));
    expect(m.gruebler).toBe(2);
    expect(m.rangeDeg).toBe(0);
  });

  it("returns range 0 when there is no motor (no ground edge)", () => {
    const req = requestOf(
      [
        { source: 1, target: 2 },
        { source: 1, target: 2 },
        { source: 2, target: 3 },
        { source: 3, target: 1 },
      ],
      4,
      null,
    );
    const m = measureCandidate(req, [
      [0, 0],
      [10, 40],
      [60, 20],
      [-30, 70],
    ]);
    expect(m.rangeDeg).toBe(0);
  });

  it("catches a build failure", () => {
    const m = measureCandidate(fourbar, []);
    expect(m).toEqual({ gruebler: null, rankDof: null, rangeDeg: 0 });
  });

  it("measures a linear (slider) input on a normalized scale", () => {
    const slider = requestOf(SLIDER_EDGES, 4, 1);
    const m = measureCandidate(
      slider,
      SLIDER_EDGES.map((e) => e.pos as Vec2Tuple),
    );
    expect(m.gruebler).toBe(1);
    expect(m.rangeDeg).toBeGreaterThan(0);
  });
});
