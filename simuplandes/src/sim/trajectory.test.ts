import { describe, it, expect } from "vitest";
import { Trajectory } from "./trajectory";
import { createDynamicsSession } from "./dynamicsSession";
import { listQuantities } from "./plots";
import { pendulum } from "../dynamics/__fixtures__/mechanisms";
import { createId, MechanismDocumentSchema, type MechanismDocument } from "../model";

/** The default pendulum with a marker on its tip. */
function markedPendulum(effort?: string): MechanismDocument {
  const base = pendulum(
    effort ? { motor: { dynamics: { mode: "effort", expression: effort } } } : {},
  );
  const bar = base.links[1];
  return MechanismDocumentSchema.parse({
    ...base,
    markers: [{ id: createId("marker"), name: "tip", linkId: bar.id, local: [1000, 0] }],
  });
}

function trajectoryFor(doc: MechanismDocument, duration: number): Trajectory {
  const session = createDynamicsSession(doc);
  expect(session.summary.status).toBe("ready");
  const quantities = listQuantities(session.system!, session.dynamics);
  return new Trajectory(session.system!, session.dynamics!, session.start!, quantities, {
    duration,
  });
}

describe("Trajectory", () => {
  it("starts with the initial frame and computes on demand", () => {
    const trajectory = trajectoryFor(markedPendulum(), 0.5);
    expect(trajectory.frameCount).toBe(1);
    expect(trajectory.computedTime).toBe(0);
    expect(trajectory.status).toBe("computing");
    expect(trajectory.compute(10)).toBe(10);
    expect(trajectory.frameCount).toBe(11);
    expect(trajectory.computedTime).toBeCloseTo(10 / 60, 12);
  });

  it("completes exactly at its duration, with a short last frame", () => {
    const trajectory = trajectoryFor(markedPendulum(), 0.21);
    trajectory.compute(1000);
    expect(trajectory.status).toBe("complete");
    expect(trajectory.computedTime).toBeCloseTo(0.21, 9);
    expect(trajectory.frameCount).toBe(14); // 0, 12 full frames to 0.2, then 0.21
    expect(trajectory.compute(5)).toBe(0);
    expect(trajectory.stop).toBeNull();
    expect(trajectory.singular).toBe(false);
  });

  it("finds the frame at a time", () => {
    const trajectory = trajectoryFor(markedPendulum(), 1);
    trajectory.compute(30);
    expect(trajectory.indexAt(-1)).toBe(0);
    expect(trajectory.indexAt(0.1)).toBe(6);
    expect(trajectory.indexAt(100)).toBe(30);
    expect(trajectory.frame(6).t).toBeCloseTo(0.1, 12);
    expect(trajectory.frameSingular(6)).toBe(false);
  });

  it("records a measurement row per frame, with dynamics quantities", () => {
    const trajectory = trajectoryFor(markedPendulum(), 1);
    trajectory.compute(60);
    const table = trajectory.table();
    expect(table.xKind).toBe("time");
    expect(table.length).toBe(61);
    const total = table.quantities.findIndex((q) => q.id === "system:energy:total");
    const column = table.columns[total];
    for (const value of column) expect(value).toBeCloseTo(column[0], 6);
    const angle = table.quantities.findIndex((q) => q.token === "angle");
    // The rod swings down from horizontal: its angle decreases.
    expect(table.columns[angle][60]).toBeLessThan(table.columns[angle][0]);
  });

  it("traces each marker", () => {
    const trajectory = trajectoryFor(markedPendulum(), 1);
    trajectory.compute(5);
    const [trace] = trajectory.traces();
    expect(trace.label).toBe("tip");
    expect(trace.closed).toBe(false);
    expect(trace.points).toHaveLength(12);
    expect(trace.points[0]).toBeCloseTo(1000, 9);
    expect(trace.points[1]).toBeCloseTo(0, 9);
    // The tip stays on its 1000 mm circle.
    expect(Math.hypot(trace.points[10], trace.points[11])).toBeCloseTo(1000, 6);
  });

  it("stops at an invalid effort and says when", () => {
    const trajectory = trajectoryFor(markedPendulum("sqrt(0.1 - t)"), 1);
    trajectory.compute(1000);
    expect(trajectory.status).toBe("stopped");
    expect(trajectory.stop).toMatchObject({ reason: "invalid-effort" });
    expect(trajectory.stop!.time).toBeCloseTo(0.1, 1);
    expect(trajectory.computedTime).toBe(trajectory.stop!.time);
  });

  it("is complete at once for a zero duration", () => {
    const trajectory = trajectoryFor(markedPendulum(), 0);
    expect(trajectory.status).toBe("complete");
    expect(trajectory.compute(10)).toBe(0);
  });

  it("works without quantities", () => {
    const session = createDynamicsSession(pendulum());
    const trajectory = new Trajectory(session.system!, session.dynamics!, session.start!, [], {
      duration: 2,
      frameInterval: 0.01,
    });
    expect(trajectory.compute(150)).toBe(150);
    expect(trajectory.table().columns).toEqual([]);
  });
});
