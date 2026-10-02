import { describe, it, expect } from "vitest";
import {
  compileSystem,
  referenceState,
  pointKinematics,
  type KinematicSystem,
} from "../kinematics";
import * as fourBar from "../kinematics/__fixtures__/fourBar";
import * as nonGrashof from "../kinematics/__fixtures__/nonGrashofFourBar";
import * as tenBar from "../kinematics/__fixtures__/tenBar";
import { computeSweep, type SweepResult } from "./sweep";
import { buildTraces } from "./traces";

function noMarkerSystem(): KinematicSystem {
  return compileSystem({ ...fourBar.build(), markers: [] });
}

describe("buildTraces: fourBar (Grashof crank-rocker, full-rotation sweep)", () => {
  const system = compileSystem(fourBar.build());
  const start = referenceState(system);
  const sweep = computeSweep(system, start, 0);

  it("one TraceData per marker, in system.markers order, points matching pointKinematics", () => {
    const traces = buildTraces(system, sweep);
    expect(traces).toHaveLength(system.markers.length);
    expect(traces[0].markerId).toBe(system.markers[0].id);
    expect(traces[0].label).toBe(system.markers[0].label);
    expect(traces[0].points).toHaveLength(sweep.samples.length * 2);

    const marker = system.markers[0];
    for (let i = 0; i < sweep.samples.length; i += 37) {
      const sample = sweep.samples[i];
      const expected = pointKinematics(
        system,
        sample.q,
        sample.qDot,
        sample.qDDot,
        marker.linkIndex,
        marker.local,
      ).position;
      expect(traces[0].points[i * 2]).toBeCloseTo(expected.x, 9);
      expect(traces[0].points[i * 2 + 1]).toBeCloseTo(expected.y, 9);
    }
  });

  it("is closed: first and last points agree within 1e-6*lengthScale", () => {
    const traces = buildTraces(system, sweep);
    expect(traces[0].closed).toBe(true);
    const n = traces[0].points.length;
    const dx = traces[0].points[n - 2] - traces[0].points[0];
    const dy = traces[0].points[n - 1] - traces[0].points[1];
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(1e-6 * system.lengthScale);
  });
});

describe("buildTraces: nonGrashofFourBar (bounded sweep) is never closed", () => {
  it("closed is false for a bounded (non-full-rotation) sweep, even with a marker", () => {
    const doc = nonGrashof.build();
    const docWithMarker = {
      ...doc,
      markers: [
        {
          id: "marker-test",
          name: "test-marker",
          linkId: doc.links.find((l) => l.name === "coupler")!.id,
          local: [nonGrashof.dims.couplerLength / 2, 20] as [number, number],
        },
      ],
    };
    const system = compileSystem(docWithMarker);
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0);

    expect(sweep.kind).toBe("bounded");
    const traces = buildTraces(system, sweep);
    expect(traces).toHaveLength(1);
    expect(traces[0].closed).toBe(false);
  });
});

describe("buildTraces: no markers", () => {
  it("returns []", () => {
    const system = noMarkerSystem();
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0);
    expect(buildTraces(system, sweep)).toEqual([]);
  });
});

describe("buildTraces: a 'full-rotation' sweep with fewer than 2 samples is not marked closed", () => {
  it("closed stays false when there's only a single sample", () => {
    const system = compileSystem(fourBar.build());
    const start = referenceState(system);
    const zeroQDot = new Float64Array(system.n);
    const singleSampleSweep: SweepResult = {
      kind: "full-rotation",
      motorIndex: 0,
      inputRate: 1,
      samples: [{ input: 0, q: Float64Array.from(start.q), qDot: zeroQDot, qDDot: zeroQDot }],
      inputMin: 0,
      inputMax: 0,
    };
    const traces = buildTraces(system, singleSampleSweep);
    expect(traces[0].closed).toBe(false);
  });
});

describe("buildTraces: 10-bar sweep", () => {
  it("traces the L9-tracer marker and closes", () => {
    const fixture = tenBar.build();
    const system = compileSystem(fixture.doc);
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0);
    const traces = buildTraces(system, sweep);
    expect(traces).toHaveLength(1);
    expect(traces[0].closed).toBe(true);
  });
});
