import { describe, it, expect } from "vitest";
import { createSimRuntime, READOUT_INTERVAL_MS, MAX_FRAMES_PER_TICK } from "./runtime";
import { createSimStore } from "./simStore";
import { FakeScheduler } from "./__fixtures__/fakeScheduler";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { doublePendulum, pendulum } from "../dynamics/__fixtures__/mechanisms";
import { createEmptyDocument, createId, MechanismDocumentSchema } from "../model";

function makeHarness(duration = 2) {
  const store = createSimStore();
  const scheduler = new FakeScheduler();
  const runtime = createSimRuntime({ store, scheduler, readoutIntervalMs: READOUT_INTERVAL_MS });
  store.getState().setDynamicsDuration(duration);
  return { store, scheduler, runtime };
}

function enterDynamics(h: ReturnType<typeof makeHarness>, doc = doublePendulum()): void {
  h.runtime.setAnalysis("dynamics");
  h.runtime.enter(doc);
}

/** Ticks until the trajectory is computed (or `limit` ticks pass). */
function computeAll(h: ReturnType<typeof makeHarness>, limit = 20): void {
  for (let i = 0; i < limit && h.store.getState().dynamics?.status === "computing"; i++) {
    h.scheduler.tick(16);
  }
}

describe("createSimRuntime: dynamics analysis", () => {
  it("builds a dynamics session and starts computing in the background", () => {
    const h = makeHarness();
    enterDynamics(h);
    const state = h.store.getState();
    expect(state.analysis).toBe("dynamics");
    expect(state.dynamics?.summary.status).toBe("ready");
    expect(state.dynamics?.summary.dof).toBe(2);
    expect(state.dynamics?.status).toBe("computing");
    expect(state.poses?.size).toBe(3);
    expect(state.readout?.time).toBe(0);
    expect(state.quantities.some((q) => q.id === "system:energy:total")).toBe(true);
    // The kinematic summary is still published (the DOF badge reads it).
    expect(state.session?.status).toBe("not-drivable");
    expect(h.scheduler.pending).toBe(1);
  });

  it("computes the whole trajectory while paused, then stops ticking", () => {
    const h = makeHarness(2);
    enterDynamics(h);
    h.scheduler.tick(16);
    const state = h.store.getState();
    expect(state.dynamics?.status).toBe("complete");
    expect(state.dynamics?.computedTime).toBeCloseTo(2, 9);
    expect(state.traces).toEqual([]);
    expect(h.runtime.getHistoryTable()?.length).toBe(121);
    expect(h.scheduler.pending).toBe(0);
    expect(state.playing).toBe(false);
  });

  it("caps the frames integrated in one tick", () => {
    const h = makeHarness(10);
    enterDynamics(h);
    h.scheduler.tick(16);
    expect(h.runtime.getHistoryTable()?.length).toBe(MAX_FRAMES_PER_TICK + 1);
    expect(h.store.getState().dynamics?.status).toBe("computing");
    computeAll(h);
    expect(h.store.getState().dynamics?.status).toBe("complete");
  });

  it("plays the trajectory in real time and loops at the end", () => {
    const h = makeHarness(2);
    enterDynamics(h);
    computeAll(h);
    h.runtime.play();
    expect(h.store.getState().playing).toBe(true);
    for (let i = 0; i < 10; i++) h.scheduler.tick(50);
    expect(h.store.getState().readout?.time).toBeCloseTo(0.5, 9);
    h.store.getState().setLoop(true);
    for (let i = 0; i < 40; i++) h.scheduler.tick(50);
    // Past 2 s it wrapped back to 0 and kept going.
    expect(h.store.getState().playing).toBe(true);
    expect(h.store.getState().readout!.time).toBeLessThan(0.6);
    h.runtime.pause();
    expect(h.store.getState().playing).toBe(false);
  });

  it("stops at the end without loop, and play() restarts from 0", () => {
    const h = makeHarness(2);
    h.store.getState().setLoop(false);
    enterDynamics(h);
    computeAll(h);
    h.runtime.play();
    for (let i = 0; i < 30; i++) h.scheduler.tick(100);
    expect(h.store.getState().playing).toBe(false);
    expect(h.store.getState().readout?.time).toBeCloseTo(2, 9);
    h.runtime.play();
    h.scheduler.tick(100);
    expect(h.store.getState().readout!.time).toBeCloseTo(0.1, 9);
  });

  it("waits for frames that are still being computed", () => {
    const h = makeHarness(10);
    enterDynamics(h);
    h.runtime.play();
    h.store.getState().setSpeed(4);
    // Playback asks for 4 x 0.1 s per tick but only computed frames exist.
    for (let i = 0; i < 3; i++) h.scheduler.tick(100);
    const { readout, dynamics } = h.store.getState();
    expect(readout!.time).toBeLessThanOrEqual(dynamics!.computedTime + 1e-9);
    expect(h.store.getState().playing).toBe(true);
  });

  it("scrubs, steps and resets over the computed frames", () => {
    const h = makeHarness(2);
    enterDynamics(h);
    computeAll(h);
    h.runtime.scrubTo(1);
    expect(h.store.getState().readout?.time).toBe(1);
    h.runtime.step(1);
    expect(h.store.getState().readout?.time).toBeCloseTo(61 / 60, 9);
    h.runtime.step(-1);
    h.runtime.step(-1);
    expect(h.store.getState().readout?.time).toBeCloseTo(59 / 60, 9);
    h.runtime.scrubTo(99);
    expect(h.store.getState().readout?.time).toBeCloseTo(2, 9);
    h.runtime.scrubTo(Number.NaN);
    expect(h.store.getState().readout?.time).toBeCloseTo(2, 9);
    h.runtime.reset();
    expect(h.store.getState().readout?.time).toBe(0);
    expect(h.runtime.snapshot()?.display).toBe(0);
  });

  it("never starts a drag in dynamics", () => {
    const h = makeHarness();
    const doc = doublePendulum();
    enterDynamics(h, doc);
    expect(h.runtime.beginDrag({ linkId: doc.links[1].id, world: { x: 100, y: 0 } })).toBe(false);
  });

  it("recomputes when the duration changes, and ignores unsupported ones", () => {
    const h = makeHarness(2);
    enterDynamics(h);
    computeAll(h);
    h.runtime.setDuration(5);
    expect(h.store.getState().dynamicsDuration).toBe(5);
    expect(h.store.getState().dynamics?.status).toBe("computing");
    computeAll(h);
    expect(h.store.getState().dynamics?.computedTime).toBeCloseTo(5, 9);
    h.runtime.setDuration(7);
    expect(h.store.getState().dynamicsDuration).toBe(5);
    expect(h.store.getState().dynamics?.status).toBe("complete");
  });

  it("switches back to kinematics", () => {
    const h = makeHarness();
    enterDynamics(h, buildFourBar());
    h.runtime.setAnalysis("kinematics");
    const state = h.store.getState();
    expect(state.analysis).toBe("kinematics");
    expect(state.dynamics).toBeNull();
    expect(state.session?.status).toBe("ready");
    expect(state.sweepTable?.length).toBe(361);
    h.runtime.setAnalysis("kinematics"); // no-op
    expect(h.store.getState().analysis).toBe("kinematics");
  });

  it("remembers the analysis chosen before entering", () => {
    const h = makeHarness();
    h.runtime.setAnalysis("dynamics");
    expect(h.store.getState().dynamics).toBeNull();
    h.runtime.enter(pendulum());
    expect(h.store.getState().dynamics?.summary.status).toBe("ready");
  });

  it("publishes a not-ready session with no trajectory and treats transport calls as no-ops", () => {
    const h = makeHarness();
    enterDynamics(h, createEmptyDocument());
    expect(h.store.getState().dynamics?.summary.status).toBe("empty");
    expect(h.store.getState().dynamics?.status).toBeNull();
    expect(h.store.getState().poses).toBeNull();
    h.runtime.play();
    h.runtime.step(1);
    h.runtime.reset();
    h.runtime.scrubTo(1);
    expect(h.store.getState().playing).toBe(false);
    expect(h.runtime.getHistoryTable()).toBeNull();
    expect(h.runtime.snapshot()).toMatchObject({ input: 0, poses: null });
  });

  it("shows the reference pose of a document that does not assemble", () => {
    const base = pendulum({ motor: { drive: { mode: "expression", expression: "t +" } } });
    const h = makeHarness();
    enterDynamics(h, base);
    expect(h.store.getState().dynamics?.summary.status).toBe("invalid-expression");
    expect(h.store.getState().poses?.size).toBe(2);
  });

  it("reports where integration stopped", () => {
    const base = pendulum({ motor: { dynamics: { mode: "effort", expression: "sqrt(0.5 - t)" } } });
    const h = makeHarness(2);
    enterDynamics(h, base);
    computeAll(h);
    const dynamics = h.store.getState().dynamics!;
    expect(dynamics.status).toBe("stopped");
    expect(dynamics.stop?.reason).toBe("invalid-effort");
    expect(h.store.getState().readout?.solver.status).toBe("no-convergence");
  });

  it("rebuilds on a document change and clears on exit", () => {
    const h = makeHarness();
    enterDynamics(h);
    const doc = MechanismDocumentSchema.parse({
      ...pendulum(),
      markers: [],
      springs: [],
    });
    h.runtime.documentChanged(doc);
    expect(h.store.getState().dynamics?.summary.dof).toBe(1);
    h.runtime.exit();
    expect(h.store.getState().dynamics).toBeNull();
    expect(h.store.getState().analysis).toBe("dynamics");
  });

  it("publishes marker traces from the trajectory", () => {
    const base = doublePendulum();
    const doc = MechanismDocumentSchema.parse({
      ...base,
      markers: [{ id: createId("marker"), linkId: base.links[2].id, local: [500, 0] }],
    });
    const h = makeHarness(2);
    enterDynamics(h, doc);
    computeAll(h);
    expect(h.store.getState().traces[0].points).toHaveLength(2 * 121);
  });

  it("keeps computing after a pause", () => {
    const h = makeHarness(10);
    enterDynamics(h);
    h.runtime.play();
    h.scheduler.tick(16);
    h.runtime.pause();
    expect(h.scheduler.pending).toBe(1);
    computeAll(h);
    expect(h.store.getState().dynamics?.status).toBe("complete");
  });
});
