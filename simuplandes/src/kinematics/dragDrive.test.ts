import { describe, it, expect, vi } from "vitest";
import { compileSystem } from "./system";
import { referenceState, solvePosition } from "./position";
import { pointKinematics } from "./query";
import * as fourBar from "./__fixtures__/fourBar";
import { normalize, perp, magnitude, type Vec2 } from "../geom";

// Partial-mocks "./velocity" so one test (below) can force a "singular"
// tangent column deterministically -- a genuinely locked mechanism's
// Jacobian is only near-singular (analyzeSingularity's ratio < 1e-3), not
// singular enough to trip `solveVelocity`'s own much stricter LU-pivot
// threshold (1e-14), so that path can't be reached from a real fixture.
// Every other call transparently forwards to the real implementation.
vi.mock("./velocity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./velocity")>();
  return { ...actual, solveVelocity: vi.fn(actual.solveVelocity) };
});

import { solveVelocity } from "./velocity";
import { estimateDragInputDelta } from "./dragDrive";

const FD_H = 1e-6;
// The FD reference solve must converge far tighter than `solvePosition`'s
// default 1e-9 tolerance: at h=1e-6, the signal itself (h * tangent) is
// only ~1e-5, so a 1e-9-scale residual noise floor already corrupts the
// derivative's 6th significant digit. Tightening to 1e-13 here (test-only)
// pushes that noise below 1e-9 relative -- confirmed empirically.
const FD_SOLVE_OPTIONS = { tolerance: 1e-13, maxIterations: 200 };

describe("estimateDragInputDelta (fourBar, reference pose, coupler-tracer marker)", () => {
  const system = compileSystem(fourBar.build());
  const state = referenceState(system);
  const marker = system.markers[0];
  const zeroQDot = new Float64Array(system.n);

  function worldAt(q: Float64Array): Vec2 {
    return pointKinematics(system, q, zeroQDot, zeroQDot, marker.linkIndex, marker.local).position;
  }

  const pointWorld0 = worldAt(state.q);

  it("tangent matches an independent finite-difference derivative of the marker's world position within 1e-6 relative", () => {
    const minus = solvePosition(system, state, new Float64Array([-FD_H]), FD_SOLVE_OPTIONS);
    const plus = solvePosition(system, state, new Float64Array([FD_H]), FD_SOLVE_OPTIONS);
    expect(minus.status).toBe("ok");
    expect(plus.status).toBe("ok");

    const pMinus = worldAt(minus.state.q);
    const pPlus = worldAt(plus.state.q);
    const fd: Vec2 = {
      x: (pPlus.x - pMinus.x) / (2 * FD_H),
      y: (pPlus.y - pMinus.y) / (2 * FD_H),
    };

    const est = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      marker.local,
      pointWorld0,
    );
    expect(est.status).toBe("ok");
    const g: Vec2 = { x: est.tangent[0], y: est.tangent[1] };

    expect(Math.abs(g.x - fd.x)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(fd.x)));
    expect(Math.abs(g.y - fd.y)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(fd.y)));
  });

  it("a pointer offset exactly along the tangent by s gives deltaInputs[0] ~= s/|g| (small damping)", () => {
    const est0 = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      marker.local,
      pointWorld0,
    );
    expect(est0.status).toBe("ok");
    const g: Vec2 = { x: est0.tangent[0], y: est0.tangent[1] };
    const gMag = magnitude(g);
    const unitG = normalize(g);

    const s = 1e-3;
    const pointerWorld: Vec2 = { x: pointWorld0.x + s * unitG.x, y: pointWorld0.y + s * unitG.y };

    const tinyDamping = 1e-15;
    const est = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      marker.local,
      pointerWorld,
      tinyDamping,
    );
    expect(est.status).toBe("ok");
    const expected = s / gMag;
    expect(Math.abs(est.deltaInputs[0] - expected)).toBeLessThanOrEqual(1e-9 * Math.abs(expected));
  });

  it("a pointer offset exactly perpendicular to the tangent gives deltaInputs[0] ~= 0", () => {
    const est0 = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      marker.local,
      pointWorld0,
    );
    expect(est0.status).toBe("ok");
    const g: Vec2 = { x: est0.tangent[0], y: est0.tangent[1] };
    const unitPerp = normalize(perp(g));

    const s = 1e-3;
    const pointerWorld: Vec2 = {
      x: pointWorld0.x + s * unitPerp.x,
      y: pointWorld0.y + s * unitPerp.y,
    };

    const tinyDamping = 1e-15;
    const est = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      marker.local,
      pointerWorld,
      tinyDamping,
    );
    expect(est.status).toBe("ok");
    expect(Math.abs(est.deltaInputs[0])).toBeLessThan(1e-12);
  });

  it("grabbing the crank's own ground pivot (local (0,0)) gives a ~zero tangent and a small, finite delta -- never NaN", () => {
    const crankIndex = system.links.findIndex((l) => l.name === "crank");
    expect(crankIndex).toBeGreaterThanOrEqual(0);
    const local: Vec2 = { x: 0, y: 0 };

    const pointerWorld: Vec2 = { x: 500, y: -500 }; // far away, would demand a huge delta if undamped
    const est = estimateDragInputDelta(system, state.q, crankIndex, local, pointerWorld);

    expect(est.status).toBe("ok");
    expect(magnitude({ x: est.tangent[0], y: est.tangent[1] })).toBeLessThan(1e-9);
    expect(Number.isFinite(est.deltaInputs[0])).toBe(true);
    expect(Math.abs(est.deltaInputs[0])).toBeLessThan(1);
  });

  it("wrong-length q gives invalid-input and a zero delta", () => {
    const est = estimateDragInputDelta(
      system,
      new Float64Array(system.n + 1),
      marker.linkIndex,
      marker.local,
      pointWorld0,
    );
    expect(est.status).toBe("invalid-input");
    expect(est.deltaInputs).toEqual(new Float64Array(system.motors.length));
    expect(est.tangent).toEqual(new Float64Array(2 * system.motors.length));
  });

  it("non-finite pointerWorld gives invalid-input and a zero delta", () => {
    const est = estimateDragInputDelta(system, state.q, marker.linkIndex, marker.local, {
      x: Number.NaN,
      y: 0,
    });
    expect(est.status).toBe("invalid-input");
    expect(est.deltaInputs).toEqual(new Float64Array(system.motors.length));
  });

  it("non-finite local point gives invalid-input", () => {
    const est = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      { x: Number.POSITIVE_INFINITY, y: 0 },
      pointWorld0,
    );
    expect(est.status).toBe("invalid-input");
  });

  it("non-finite damping gives invalid-input", () => {
    const est = estimateDragInputDelta(
      system,
      state.q,
      marker.linkIndex,
      marker.local,
      pointWorld0,
      Number.NaN,
    );
    expect(est.status).toBe("invalid-input");
  });

  it("out-of-range linkIndex gives invalid-input", () => {
    const est = estimateDragInputDelta(
      system,
      state.q,
      system.links.length,
      marker.local,
      pointWorld0,
    );
    expect(est.status).toBe("invalid-input");
  });

  it("a ground linkIndex gives invalid-input", () => {
    const groundIndex = system.links.findIndex((l) => l.isGround);
    expect(groundIndex).toBeGreaterThanOrEqual(0);
    const est = estimateDragInputDelta(system, state.q, groundIndex, marker.local, pointWorld0);
    expect(est.status).toBe("invalid-input");
  });
});

describe("estimateDragInputDelta: singular tangent (mocked solveVelocity)", () => {
  it("returns status 'singular' with a zero delta if any motor's tangent solve fails", () => {
    const system = compileSystem(fourBar.build());
    const state = referenceState(system);
    const marker = system.markers[0];

    vi.mocked(solveVelocity).mockReturnValueOnce({
      status: "singular",
      values: new Float64Array(system.n),
    });

    const est = estimateDragInputDelta(system, state.q, marker.linkIndex, marker.local, {
      x: 0,
      y: 0,
    });

    expect(est.status).toBe("singular");
    expect(est.deltaInputs).toEqual(new Float64Array(system.motors.length));
    expect(est.tangent).toEqual(new Float64Array(2 * system.motors.length));
    expect(vi.mocked(solveVelocity)).toHaveBeenCalledTimes(1);
  });
});
