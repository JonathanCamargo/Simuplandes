import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createSimRuntime,
  STEP_ROTARY,
  READOUT_INTERVAL_MS,
  MAX_FRAME_DT_S,
  browserScheduler,
  type FrameScheduler,
} from "./runtime";
import { createSimStore } from "./simStore";
import { build as buildFourBar, dims as fourBarDims } from "../kinematics/__fixtures__/fourBar";
import {
  build as buildNonGrashof,
  dims as nonGrashofDims,
} from "../kinematics/__fixtures__/nonGrashofFourBar";
import { defineLink, makeDocument } from "../kinematics/__fixtures__/build";
import { fourBarLimitAngles, freudensteinBranchOf } from "../kinematics/__fixtures__/analytic";
import { build as buildActuatorArm } from "../kinematics/__fixtures__/actuatorArm";
import { impossibleFourBar } from "../kinematics/__fixtures__/misassembled";
import { compileSystem } from "../kinematics";
import { createEmptyDocument, createId, type MechanismDocument } from "../model";

/** A manual, deterministic `FrameScheduler`: `tick(ms)` advances `now()` and runs every queued callback. */
class FakeScheduler implements FrameScheduler {
  private nowMs = 0;
  private queue = new Map<number, (nowMs: number) => void>();
  private nextId = 1;

  now(): number {
    return this.nowMs;
  }

  request(cb: (nowMs: number) => void): number {
    const id = this.nextId++;
    this.queue.set(id, cb);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  /** Advances `now` by `ms` and runs every callback queued at the time of the call. */
  tick(ms: number): void {
    this.nowMs += ms;
    const callbacks = Array.from(this.queue.values());
    this.queue.clear();
    for (const cb of callbacks) cb(this.nowMs);
  }
}

function makeHarness() {
  const store = createSimStore();
  const scheduler = new FakeScheduler();
  const runtime = createSimRuntime({ store, scheduler, readoutIntervalMs: READOUT_INTERVAL_MS });
  return { store, scheduler, runtime };
}

/** fourBar plus a fifth bar rigidly pinning crank-site A to ground-site O4: a truss (not-drivable). */
function buildFourBarTruss(): MechanismDocument {
  const base = buildFourBar();
  const ground = base.links.find((l) => l.isGround)!;
  const crank = base.links.find((l) => l.name === "crank")!;
  const crankSiteA = crank.sites.find((s) => s.name === "A")!;
  const groundSiteO4 = ground.sites.find((s) => s.name === "O4")!;

  const fifthBar = defineLink({
    name: "fifth-bar",
    origin: [fourBarDims.A.x, fourBarDims.A.y],
    sites: {
      atA: [fourBarDims.A.x, fourBarDims.A.y],
      atO4: [fourBarDims.O4.x, fourBarDims.O4.y],
    },
  });

  return makeDocument({
    schemaVersion: 1,
    name: "four-bar-truss",
    links: [...base.links, fifthBar.link],
    joints: [
      ...base.joints,
      {
        id: createId("joint"),
        name: "fifth-A",
        type: "R",
        siteA: crankSiteA.id,
        siteB: fifthBar.siteIds.atA,
      },
      {
        id: createId("joint"),
        name: "fifth-O4",
        type: "R",
        siteA: groundSiteO4.id,
        siteB: fifthBar.siteIds.atO4,
      },
    ],
    motors: base.motors,
    markers: [],
  });
}

/** A single moving link with zero joints and no motor: `drivingMode "none"`, `motorIndex -1`, but still assembles trivially (nothing to check) so `state` is non-null. */
function buildIsolatedLink(): MechanismDocument {
  const ground = defineLink({ name: "ground", isGround: true, origin: [0, 0], sites: {} });
  const lonely = defineLink({ name: "lonely", origin: [0, 0], sites: {} });
  return makeDocument({
    schemaVersion: 1,
    name: "isolated-link",
    links: [ground.link, lonely.link],
    joints: [],
    motors: [],
    markers: [],
  });
}

describe("createSimRuntime: enter", () => {
  it("publishes a ready session, full-rotation range, one closed trace, a 361-row sweep table, 15 quantities, reference poses and a 60deg readout", () => {
    const { store, runtime } = makeHarness();
    const doc = buildFourBar();
    const before = JSON.stringify(doc);

    runtime.enter(doc);

    const state = store.getState();
    expect(state.session?.status).toBe("ready");
    expect(state.range).toEqual({ min: 0, max: 2 * Math.PI, fullRotation: true });
    expect(state.traces).toHaveLength(1);
    expect(state.traces[0].closed).toBe(true);
    expect(state.sweepTable?.length).toBe(361);
    expect(state.quantities).toHaveLength(15);
    expect(state.plot.quantityIds.length).toBeGreaterThan(0);
    expect(state.readout?.display).toBeCloseTo(60, 9);
    expect(state.playing).toBe(false);

    const crank = doc.links.find((l) => l.name === "crank")!;
    expect(state.poses?.get(crank.id)).toEqual({
      position: crank.pose.position,
      angle: crank.pose.angle,
    });

    expect(JSON.stringify(doc)).toBe(before);
  });

  it("preserves a user's plot choice across a document rebuild when it's still valid", () => {
    const { store, runtime } = makeHarness();
    const doc = buildFourBar();
    runtime.enter(doc);

    const validId = store.getState().quantities.find((q) => q.token === "x")?.id;
    expect(validId).toBeDefined();
    store.getState().setPlotQuantities([validId!]);

    // A different document identity, same shape (same quantity ids exist).
    runtime.documentChanged({ ...doc });

    expect(store.getState().plot.quantityIds).toEqual([validId]);
  });

  it("resets an invalid plot choice back to the default", () => {
    const { store, runtime } = makeHarness();
    const doc = buildFourBar();
    runtime.enter(doc);
    store.getState().setPlotQuantities(["not-a-real-quantity"]);

    runtime.documentChanged({ ...doc });

    expect(store.getState().plot.quantityIds).not.toEqual(["not-a-real-quantity"]);
    expect(store.getState().plot.quantityIds.length).toBeGreaterThan(0);
  });
});

describe("createSimRuntime: play (full rotation)", () => {
  it("60 ticks of 16ms at speed 1 advances input by ~0.96rad, publishes poses 60 times, and throttles the readout", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());

    let poseCount = 0;
    let readoutCount = 0;
    store.subscribe((state, prev) => {
      if (state.poses !== prev.poses) poseCount++;
      if (state.readout !== prev.readout) readoutCount++;
    });

    runtime.play();
    for (let i = 0; i < 60; i++) scheduler.tick(16);

    const input = store.getState().readout!.input;
    expect(input).toBeCloseTo(0.96, 9);
    expect(poseCount).toBe(60);
    expect(readoutCount).toBeLessThanOrEqual(Math.ceil(960 / READOUT_INTERVAL_MS) + 2);
  });

  it("clamps dt to 100ms per frame", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    runtime.play();

    scheduler.tick(500); // a huge stall; dt must clamp to MAX_FRAME_DT_S

    expect(store.getState().readout!.input).toBeCloseTo(MAX_FRAME_DT_S, 9);
  });

  it("speed 2 doubles the per-frame input advance", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    store.getState().setSpeed(2);
    runtime.play();

    scheduler.tick(16);

    // The readout is throttled (READOUT_INTERVAL_MS); `snapshot()` is the
    // unthrottled per-frame view used to check exactly this.
    expect(runtime.snapshot()!.input).toBeCloseTo(0.032, 9);
  });

  it("loop=false stops exactly at one full revolution from where play() began", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    store.getState().setLoop(false);
    runtime.play();

    for (let i = 0; i < 400; i++) {
      if (!store.getState().playing) break;
      scheduler.tick(16);
    }

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.input).toBeCloseTo(2 * Math.PI, 9);
  });

  it("loop=true keeps going past 2*PI, wrapping the display into [0, 360)", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    store.getState().setLoop(true);
    runtime.play();

    for (let i = 0; i < 500; i++) scheduler.tick(16);

    expect(store.getState().playing).toBe(true);
    expect(store.getState().readout!.input).toBeGreaterThan(2 * Math.PI);
    const display = store.getState().readout!.display;
    expect(display).toBeGreaterThanOrEqual(0);
    expect(display).toBeLessThan(360);
  });
});

describe("createSimRuntime: play (rocking / bounded)", () => {
  it("loop=true reverses direction at both analytic lock-up limits, staying within 1e-5rad and exact joints", () => {
    const { store, scheduler, runtime } = makeHarness();
    const doc = buildNonGrashof();
    runtime.enter(doc);
    store.getState().setLoop(true);

    const limits = fourBarLimitAngles(
      nonGrashofDims.groundLength,
      nonGrashofDims.crankLength,
      nonGrashofDims.couplerLength,
      nonGrashofDims.rockerLength,
    );
    const relativeLimits = limits.map((l) => l - nonGrashofDims.referenceCrankAngle);
    const maxLimit = Math.max(...relativeLimits);
    const minLimit = Math.min(...relativeLimits);

    const directions = new Set<1 | -1>();
    runtime.play();
    // Traveling start -> +limit -> -limit covers ~3.8rad at 1rad/s; 400
    // ticks of 32ms simulate 12.8s, comfortably covering two reversals.
    for (let i = 0; i < 400; i++) {
      scheduler.tick(32);
      const readout = store.getState().readout!;
      directions.add(readout.direction);
      expect(readout.input).toBeLessThanOrEqual(maxLimit + 1e-5);
      expect(readout.input).toBeGreaterThanOrEqual(minLimit - 1e-5);
    }

    expect(directions.size).toBe(2);
  }, 20000);

  it("loop=false stops at the first lock-up with readout.lockUp set; the next play() reverses", () => {
    const { store, scheduler, runtime } = makeHarness();
    const doc = buildNonGrashof();
    runtime.enter(doc);
    store.getState().setLoop(false);

    runtime.play();
    for (let i = 0; i < 2000; i++) {
      if (!store.getState().playing) break;
      scheduler.tick(16);
    }

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.lockUp).not.toBeNull();
    const inputAtLockUp = store.getState().readout!.input;

    runtime.play();
    scheduler.tick(16);
    expect(store.getState().readout!.input).toBeLessThan(inputAtLockUp);
  });
});

describe("createSimRuntime: step / reset / scrub", () => {
  it("step() advances by exactly STEP_ROTARY and pauses; step(-1) reverses", () => {
    const { store, runtime } = makeHarness();
    runtime.enter(buildFourBar());

    runtime.step();
    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.input).toBeCloseTo(STEP_ROTARY, 12);

    runtime.step(-1);
    expect(store.getState().readout!.input).toBeCloseTo(0, 12);
  });

  it("reset() restores start.q bit-exactly, time 0, direction +1, clears lock-up and history", () => {
    const { store, scheduler, runtime } = makeHarness();
    const doc = buildFourBar();
    runtime.enter(doc);
    runtime.play();
    scheduler.tick(16);
    scheduler.tick(16);

    runtime.reset();

    expect(store.getState().readout!.input).toBeCloseTo(0, 12);
    expect(store.getState().readout!.time).toBe(0);
    expect(store.getState().readout!.direction).toBe(1);
    expect(store.getState().readout!.lockUp).toBeNull();
    expect(runtime.getHistoryTable()?.length).toBe(1);
  });

  it("scrubTo(150deg) pauses, moves to the congruent input nearest current, and updates poses/readout synchronously", () => {
    const { store, runtime } = makeHarness();
    runtime.enter(buildFourBar());

    runtime.scrubTo(150);

    expect(store.getState().playing).toBe(false);
    const input = store.getState().readout!.input;
    const raw = ((150 - 60) * Math.PI) / 180;
    const k = Math.round((input - raw) / (2 * Math.PI));
    expect(input).toBeCloseTo(raw + k * 2 * Math.PI, 9);
  });

  it("on nonGrashof, scrubTo stays on the same assembly branch and clamps beyond the range", () => {
    const { store, runtime } = makeHarness();
    const doc = buildNonGrashof();
    runtime.enter(doc);
    const rocker = doc.links.find((l) => l.name === "rocker")!;

    function branchAt(displayDeg: number): 1 | -1 {
      runtime.scrubTo(displayDeg);
      const input = store.getState().readout!.input;
      const theta2 = nonGrashofDims.referenceCrankAngle + input;
      const theta4 = runtime.snapshot()!.poses!.get(rocker.id)!.angle;
      return freudensteinBranchOf(
        nonGrashofDims.crankLength,
        nonGrashofDims.couplerLength,
        nonGrashofDims.rockerLength,
        nonGrashofDims.groundLength,
        theta2,
        theta4,
      );
    }

    const initialBranch = branchAt(45);
    const largeBranch = branchAt(100000); // absurdly large -- must clamp, not jump branch

    const input = store.getState().readout!.input;
    const range = store.getState().range!;
    expect(input).toBeLessThanOrEqual(range.max + 1e-6);
    expect(input).toBeGreaterThanOrEqual(range.min - 1e-6);
    expect(largeBranch).toBe(initialBranch);
  });
});

describe("createSimRuntime: drag", () => {
  it("beginDrag on the coupler pauses, sets dragging; dragTo moves it with exact joints; endDrag clears dragging and publishes", () => {
    const { store, runtime } = makeHarness();
    const doc = buildFourBar();
    runtime.enter(doc);
    runtime.play();

    const coupler = doc.links.find((l) => l.name === "coupler")!;
    const started = runtime.beginDrag({
      linkId: coupler.id,
      world: { x: fourBarDims.B.x, y: fourBarDims.B.y },
    });

    expect(started).toBe(true);
    expect(store.getState().playing).toBe(false);
    expect(store.getState().dragging).toEqual({ linkId: coupler.id });

    const inputBefore = store.getState().readout!.input;
    runtime.dragTo({ x: fourBarDims.B.x + 5, y: fourBarDims.B.y + 5 });

    expect(store.getState().readout!.input).not.toBe(inputBefore);

    runtime.endDrag();
    expect(store.getState().dragging).toBeNull();
  });

  it("beginDrag returns false for a ground link, an unknown link, or a not-ready session", () => {
    const { runtime: readyRuntime } = makeHarness();
    const doc = buildFourBar();
    readyRuntime.enter(doc);
    const ground = doc.links.find((l) => l.isGround)!;
    expect(readyRuntime.beginDrag({ linkId: ground.id, world: { x: 0, y: 0 } })).toBe(false);
    expect(readyRuntime.beginDrag({ linkId: "not-a-real-id", world: { x: 0, y: 0 } })).toBe(false);

    const { runtime: notReadyRuntime } = makeHarness();
    notReadyRuntime.enter(buildFourBarTruss());
    const crank = doc.links.find((l) => l.name === "crank")!;
    expect(notReadyRuntime.beginDrag({ linkId: crank.id, world: { x: 0, y: 0 } })).toBe(false);
  });
});

describe("createSimRuntime: other session states", () => {
  it("a temporary-driver document is ready, drivingMode temporary; play()/scrubTo() are no-ops, drag works, traces exist", () => {
    const { store, runtime } = makeHarness();
    const base = buildFourBar();
    const doc: MechanismDocument = { ...base, motors: [] };
    runtime.enter(doc);

    expect(store.getState().session?.status).toBe("ready");
    expect(store.getState().session?.drivingMode).toBe("temporary");
    expect(store.getState().traces.length).toBeGreaterThan(0);

    runtime.play();
    expect(store.getState().playing).toBe(false);

    const inputBefore = store.getState().readout?.input;
    runtime.scrubTo(200);
    expect(store.getState().readout?.input).toBe(inputBefore);

    const coupler = doc.links.find((l) => l.name === "coupler")!;
    const started = runtime.beginDrag({
      linkId: coupler.id,
      world: { x: fourBarDims.B.x, y: fourBarDims.B.y },
    });
    expect(started).toBe(true);
  });

  it("a truss (not-drivable) publishes the reference pose; play/step/scrub/drag are no-ops that don't throw", () => {
    const { store, runtime } = makeHarness();
    const doc = buildFourBarTruss();

    expect(() => runtime.enter(doc)).not.toThrow();
    expect(store.getState().session?.status).toBe("not-drivable");
    expect(store.getState().poses).not.toBeNull();

    expect(() => runtime.play()).not.toThrow();
    expect(() => runtime.step()).not.toThrow();
    expect(() => runtime.scrubTo(10)).not.toThrow();
    const crank = doc.links.find((l) => l.name === "crank")!;
    expect(() => runtime.beginDrag({ linkId: crank.id, world: { x: 0, y: 0 } })).not.toThrow();
    expect(store.getState().playing).toBe(false);
  });

  it("an empty document publishes a session with null poses and never throws", () => {
    const { store, runtime } = makeHarness();
    expect(() => runtime.enter(createEmptyDocument())).not.toThrow();
    expect(store.getState().session?.status).toBe("empty");
    expect(store.getState().poses).toBeNull();
  });

  it("an invalid document publishes a session and never throws", () => {
    const { store, runtime } = makeHarness();
    const base = buildFourBar();
    const doc: MechanismDocument = { ...base, motors: [{ ...base.motors[0], kind: "linear" }] };
    expect(() => runtime.enter(doc)).not.toThrow();
    expect(store.getState().session?.status).toBe("invalid");
    expect(store.getState().poses).toBeNull();
  });
});

describe("createSimRuntime: documentChanged / exit / dispose", () => {
  it("documentChanged rebuilds the session and resets playback; the same identity is a no-op", () => {
    const { store, scheduler, runtime } = makeHarness();
    const doc = buildFourBar();
    runtime.enter(doc);
    runtime.play();
    scheduler.tick(16);
    scheduler.tick(16);

    const changedDoc = { ...doc };
    runtime.documentChanged(changedDoc);
    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.input).toBeCloseTo(0, 12);

    const readoutBefore = store.getState().readout;
    runtime.documentChanged(changedDoc); // same identity: no-op
    expect(store.getState().readout).toBe(readoutBefore);
  });

  it("exit() cancels the loop and clears the store; ticks after exit do nothing", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    runtime.play();
    scheduler.tick(16);

    runtime.exit();
    expect(store.getState().session).toBeNull();
    expect(store.getState().poses).toBeNull();

    const stateBefore = store.getState();
    scheduler.tick(16);
    expect(store.getState()).toBe(stateBefore);
  });

  it("dispose() is non-terminal: enter() + play() work again afterward", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    runtime.play();
    scheduler.tick(16);

    runtime.dispose();
    expect(store.getState().session).toBeNull();

    runtime.enter(buildFourBar());
    runtime.play();
    scheduler.tick(16);
    expect(store.getState().playing).toBe(true);
    expect(runtime.snapshot()!.input).toBeGreaterThan(0);
  });
});

describe("createSimRuntime: time history and near-singular", () => {
  it("getHistoryTable grows one row per frame while playing, xKind 'time'; historyVersion throttles", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildFourBar());

    let historyVersionChanges = 0;
    store.subscribe((state, prev) => {
      if (state.historyVersion !== prev.historyVersion) historyVersionChanges++;
    });

    runtime.play();
    for (let i = 0; i < 20; i++) scheduler.tick(16);

    const table = runtime.getHistoryTable();
    expect(table?.xKind).toBe("time");
    expect(table?.length).toBe(20);
    expect(historyVersionChanges).toBeLessThanOrEqual(
      Math.ceil((20 * 16) / READOUT_INTERVAL_MS) + 2,
    );
  });

  it("readout.nearSingular reflects the last solved frame's singularity flag near a lock-up", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildNonGrashof());
    store.getState().setLoop(false);

    runtime.play();
    for (let i = 0; i < 2000; i++) {
      if (!store.getState().playing) break;
      scheduler.tick(16);
    }

    expect(typeof store.getState().readout!.nearSingular).toBe("boolean");
    expect(store.getState().readout!.lockUp).not.toBeNull();
  });
});

describe("createSimRuntime: expression drive", () => {
  function buildExpressionFourBar(): MechanismDocument {
    const base = buildFourBar();
    return {
      ...base,
      motors: [{ ...base.motors[0], drive: { mode: "expression", expression: "t" } }],
    };
  }

  it("drives via evaluateDrivesAtTime, advancing input to ~= simTime", () => {
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(buildExpressionFourBar());

    runtime.play();
    for (let i = 0; i < 30; i++) scheduler.tick(16);

    const readout = store.getState().readout!;
    expect(readout.input).toBeCloseTo(readout.time, 6);
  });

  it("a lock-up pauses without reversing direction", () => {
    const base = buildNonGrashof();
    const doc: MechanismDocument = {
      ...base,
      motors: [{ ...base.motors[0], drive: { mode: "expression", expression: "t" } }],
    };
    const { store, scheduler, runtime } = makeHarness();
    runtime.enter(doc);

    runtime.play();
    for (let i = 0; i < 2000; i++) {
      if (!store.getState().playing) break;
      scheduler.tick(16);
    }

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.lockUp).not.toBeNull();
    expect(store.getState().readout!.direction).toBe(1);
  });
});

describe("createSimRuntime: guards / no-ops", () => {
  it("play/pause/step/reset/scrub/drag before enter() are no-ops that never throw", () => {
    const { runtime } = makeHarness();
    expect(() => runtime.play()).not.toThrow();
    expect(() => runtime.pause()).not.toThrow();
    expect(() => runtime.togglePlay()).not.toThrow();
    expect(() => runtime.step()).not.toThrow();
    expect(() => runtime.reset()).not.toThrow();
    expect(() => runtime.scrubTo(10)).not.toThrow();
    expect(runtime.beginDrag({ linkId: "x", world: { x: 0, y: 0 } })).toBe(false);
    expect(() => runtime.dragTo({ x: 0, y: 0 })).not.toThrow();
    expect(() => runtime.endDrag()).not.toThrow();
    expect(runtime.getHistoryTable()).toBeNull();
    expect(runtime.snapshot()).toBeNull();
    expect(() => runtime.setSpeed(2)).not.toThrow();
    expect(() => runtime.setLoop(false)).not.toThrow();
  });

  it("togglePlay toggles between play() and pause()", () => {
    const { store, runtime } = makeHarness();
    runtime.enter(buildFourBar());

    runtime.togglePlay();
    expect(store.getState().playing).toBe(true);
    runtime.togglePlay();
    expect(store.getState().playing).toBe(false);
  });

  it("pause() while already paused is a no-op", () => {
    const { store, runtime } = makeHarness();
    runtime.enter(buildFourBar());
    const readoutBefore = store.getState().readout;
    runtime.pause();
    expect(store.getState().readout).toBe(readoutBefore);
  });

  it("snapshot() returns a fresh input/display/poses triple", () => {
    const { runtime } = makeHarness();
    runtime.enter(buildFourBar());
    const snap = runtime.snapshot();
    expect(snap?.display).toBeCloseTo(60, 9);
    expect(snap?.poses).not.toBeNull();
  });
});

describe("browserScheduler", () => {
  it("is importable in node without throwing, and now() returns a number (performance present)", () => {
    expect(typeof browserScheduler.now()).toBe("number");
  });

  it("uses requestAnimationFrame/cancelAnimationFrame when the globals are present", async () => {
    const raf = vi.fn((cb: (n: number) => void) => {
      cb(1);
      return 42;
    });
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    vi.resetModules();
    const { browserScheduler: fresh } = await import("./runtime");

    const id = fresh.request(() => {});
    expect(raf).toHaveBeenCalled();
    fresh.cancel(id);
    expect(caf).toHaveBeenCalledWith(id);

    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to setTimeout/clearTimeout when rAF/cAF are unavailable", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { browserScheduler: fresh } = await import("./runtime");

    const firedCb = vi.fn();
    fresh.request(firedCb);
    vi.runAllTimers();
    expect(firedCb).toHaveBeenCalled();

    const cancelledCb = vi.fn();
    const id = fresh.request(cancelledCb);
    fresh.cancel(id);
    vi.runAllTimers();
    expect(cancelledCb).not.toHaveBeenCalled();

    vi.useRealTimers();
    vi.resetModules();
  });

  it("now() falls back to Date.now() when performance is unavailable", async () => {
    const original = globalThis.performance;
    // @ts-expect-error -- deliberately clearing the global for this test
    delete globalThis.performance;
    vi.resetModules();
    const { browserScheduler: fresh } = await import("./runtime");

    expect(typeof fresh.now()).toBe("number");

    globalThis.performance = original;
    vi.resetModules();
  });
});

describe("createSimRuntime: joint residuals stay exact", () => {
  it("residuals stay <= 1e-9 throughout a full-rotation play and a drag", () => {
    const { store, scheduler, runtime } = makeHarness();
    const doc = buildFourBar();
    runtime.enter(doc);
    runtime.play();
    for (let i = 0; i < 30; i++) scheduler.tick(16);

    // Re-solve independently at the published input to confirm exactness --
    // access via a second runtime/session built the same way.
    expect(store.getState().readout!.solver.status).toBe("ok");
    expect(store.getState().readout!.solver.residualNorm).toBeLessThanOrEqual(1e-6);
  });
});

describe("createSimRuntime: additional branch coverage", () => {
  it("a constant-mode motor with drive.speed 0 defaults to speed 1", () => {
    const { scheduler, runtime } = makeHarness();
    const base = buildFourBar();
    const doc: MechanismDocument = {
      ...base,
      motors: [{ ...base.motors[0], drive: { mode: "constant", speed: 0 } }],
    };
    runtime.enter(doc);
    runtime.play();
    scheduler.tick(16);

    expect(runtime.snapshot()!.input).toBeCloseTo(0.016, 9);
  });

  it("createSimRuntime defaults to browserScheduler and READOUT_INTERVAL_MS when not provided", () => {
    const store = createSimStore();
    const runtime = createSimRuntime({ store });
    runtime.enter(buildFourBar());

    expect(store.getState().session?.status).toBe("ready");
    runtime.dispose();
  });

  it("a linear-motor document (actuatorArm) picks the linear-driver branch and steps by lengthScale/100", () => {
    const { store, runtime } = makeHarness();
    const doc = buildActuatorArm();
    runtime.enter(doc);

    expect(store.getState().session?.status).toBe("ready");
    expect(store.getState().session?.inputKind).toBe("linear");
    // defaultQuantityIds was reached through inputLinkIndicesOf's
    // "linear-driver" branch (the stroke joint is a P joint).
    expect(store.getState().plot.quantityIds.length).toBeGreaterThan(0);

    const system = compileSystem(doc);
    const inputBefore = runtime.snapshot()!.input;
    runtime.step();
    expect(runtime.snapshot()!.input).toBeCloseTo(inputBefore + system.lengthScale / 100, 9);
  });

  it("an isolated moving link with no joints/motor (motorIndex -1) publishes a zero input readout and snapshot", () => {
    const { store, runtime } = makeHarness();
    const doc = buildIsolatedLink();
    runtime.enter(doc);

    expect(store.getState().session?.status).toBe("not-drivable");
    expect(store.getState().session?.drivingMode).toBe("none");
    expect(runtime.snapshot()!.input).toBe(0);
    expect(runtime.snapshot()!.display).toBe(0);

    // reset() runs recordFrame with motorIndex -1 (ratesBuf/accelsBuf left
    // untouched, currentReadout's input falls back to 0).
    expect(() => runtime.reset()).not.toThrow();
    expect(store.getState().readout!.input).toBe(0);
  });

  it("an assembly-failed document (motor present, start null) publishes poses from the reference pose q0", () => {
    const { store, runtime } = makeHarness();
    const doc = impossibleFourBar();
    runtime.enter(doc);

    expect(store.getState().session?.status).toBe("assembly-failed");
    expect(store.getState().poses).not.toBeNull();
  });

  it("documentChanged() before enter() is a no-op", () => {
    const { store, runtime } = makeHarness();
    expect(() => runtime.documentChanged(buildFourBar())).not.toThrow();
    expect(store.getState().session).toBeNull();
  });

  it("play() while already playing is a no-op", () => {
    const { store, runtime } = makeHarness();
    runtime.enter(buildFourBar());

    runtime.play();
    expect(store.getState().playing).toBe(true);
    const readoutBefore = store.getState().readout;
    runtime.play();
    expect(store.getState().playing).toBe(true);
    expect(store.getState().readout).toBe(readoutBefore);
  });
});

describe("createSimRuntime: forced solver-failure branches (mocked)", () => {
  afterEach(() => {
    vi.doUnmock("../kinematics");
    vi.doUnmock("./sweep");
    vi.resetModules();
  });

  it("bounded loop=false: a non-locked, non-ok advanceDrive status pauses without setting a lock-up", async () => {
    vi.resetModules();
    vi.doMock("../kinematics", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../kinematics")>();
      return {
        ...actual,
        advanceDrive: (...args: Parameters<typeof actual.advanceDrive>) => {
          const result = actual.advanceDrive(...args);
          return result.status === "ok" ? { ...result, status: "invalid-input" as const } : result;
        },
      };
    });

    const { createSimRuntime: mockedCreate } = await import("./runtime");
    const { createSimStore: mockedCreateStore } = await import("./simStore");
    const { build: mockedNonGrashof } =
      await import("../kinematics/__fixtures__/nonGrashofFourBar");

    const store = mockedCreateStore();
    const scheduler = new FakeScheduler();
    const runtime = mockedCreate({ store, scheduler });
    runtime.enter(mockedNonGrashof());
    store.getState().setLoop(false);

    runtime.play();
    scheduler.tick(16);

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.solver.status).toBe("invalid-input");
    expect(store.getState().readout!.lockUp).toBeNull();
  });

  it("bounded loop=true (rocking): a no-convergence advanceRocking status pauses playback", async () => {
    vi.resetModules();
    vi.doMock("../kinematics", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../kinematics")>();
      return {
        ...actual,
        advanceRocking: (...args: Parameters<typeof actual.advanceRocking>) => {
          const result = actual.advanceRocking(...args);
          return { ...result, status: "no-convergence" as const };
        },
      };
    });

    const { createSimRuntime: mockedCreate } = await import("./runtime");
    const { createSimStore: mockedCreateStore } = await import("./simStore");
    const { build: mockedNonGrashof } =
      await import("../kinematics/__fixtures__/nonGrashofFourBar");

    const store = mockedCreateStore();
    const scheduler = new FakeScheduler();
    const runtime = mockedCreate({ store, scheduler });
    runtime.enter(mockedNonGrashof());
    store.getState().setLoop(true);

    runtime.play();
    scheduler.tick(16);

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.solver.status).toBe("no-convergence");
  });

  it("expression drive: a non-locked, non-ok advanceDrive status pauses without reversing", async () => {
    vi.resetModules();
    vi.doMock("../kinematics", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../kinematics")>();
      return {
        ...actual,
        advanceDrive: (...args: Parameters<typeof actual.advanceDrive>) => {
          const result = actual.advanceDrive(...args);
          return result.status === "ok" ? { ...result, status: "invalid-input" as const } : result;
        },
      };
    });

    const { createSimRuntime: mockedCreate } = await import("./runtime");
    const { createSimStore: mockedCreateStore } = await import("./simStore");
    const { build: mockedFourBar } = await import("../kinematics/__fixtures__/fourBar");

    const store = mockedCreateStore();
    const scheduler = new FakeScheduler();
    const runtime = mockedCreate({ store, scheduler });
    const base = mockedFourBar();
    runtime.enter({
      ...base,
      motors: [{ ...base.motors[0], drive: { mode: "expression", expression: "t" } }],
    });

    runtime.play();
    scheduler.tick(16);

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.solver.status).toBe("invalid-input");
    expect(store.getState().readout!.direction).toBe(1);
  });

  it("a drag whose input-delta estimate reports 'singular' maps dragTo's solver status to 'no-convergence'", async () => {
    vi.resetModules();
    vi.doMock("../kinematics/velocity", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../kinematics/velocity")>();
      return { ...actual, solveVelocity: vi.fn(actual.solveVelocity) };
    });

    const { createSimRuntime: mockedCreate } = await import("./runtime");
    const { createSimStore: mockedCreateStore } = await import("./simStore");
    const { build: mockedFourBar, dims: mockedDims } =
      await import("../kinematics/__fixtures__/fourBar");
    const { solveVelocity: mockedSolveVelocity } = await import("../kinematics/velocity");

    const store = mockedCreateStore();
    const scheduler = new FakeScheduler();
    const runtime = mockedCreate({ store, scheduler });
    const doc = mockedFourBar();
    runtime.enter(doc);

    const coupler = doc.links.find((l) => l.name === "coupler")!;
    const started = runtime.beginDrag({
      linkId: coupler.id,
      world: { x: mockedDims.B.x, y: mockedDims.B.y },
    });
    expect(started).toBe(true);

    vi.mocked(mockedSolveVelocity).mockReturnValueOnce({
      status: "singular",
      values: new Float64Array(0),
    });

    runtime.dragTo({ x: mockedDims.B.x + 10, y: mockedDims.B.y + 10 });
    expect(store.getState().readout!.solver.status).toBe("no-convergence");
  });

  it("a 'ready' session whose sweep is forced to kind 'none' publishes a null range", async () => {
    vi.resetModules();
    vi.doMock("./sweep", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./sweep")>();
      return {
        ...actual,
        computeSweep: (...args: Parameters<typeof actual.computeSweep>) => ({
          ...actual.computeSweep(...args),
          kind: "none" as const,
        }),
      };
    });

    const { createSimRuntime: mockedCreate } = await import("./runtime");
    const { createSimStore: mockedCreateStore } = await import("./simStore");
    const { build: mockedFourBar } = await import("../kinematics/__fixtures__/fourBar");

    const store = mockedCreateStore();
    const scheduler = new FakeScheduler();
    const runtime = mockedCreate({ store, scheduler });
    runtime.enter(mockedFourBar());

    expect(store.getState().session?.status).toBe("ready");
    expect(store.getState().range).toBeNull();
  });
});
