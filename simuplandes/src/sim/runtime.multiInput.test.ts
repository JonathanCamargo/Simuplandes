import { describe, it, expect } from "vitest";
import { createSimRuntime, STEP_ROTARY, type FrameScheduler } from "./runtime";
import { createSimStore } from "./simStore";
import { build as buildFiveBar, dims as fiveBarDims } from "../kinematics/__fixtures__/fiveBar";
import type { MechanismDocument } from "../model";

/** A manual, deterministic `FrameScheduler` (same as `runtime.test.ts`'s). */
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

  tick(ms: number): void {
    this.nowMs += ms;
    const callbacks = Array.from(this.queue.values());
    this.queue.clear();
    for (const cb of callbacks) cb(this.nowMs);
  }
}

function makeHarness(doc: MechanismDocument = buildFiveBar()) {
  const store = createSimStore();
  const scheduler = new FakeScheduler();
  const runtime = createSimRuntime({ store, scheduler });
  runtime.enter(doc);
  return { store, scheduler, runtime, doc };
}

/** Both cranks' world angles, from the snapshot's link poses. */
function crankAngles(
  runtime: ReturnType<typeof createSimRuntime>,
  doc: MechanismDocument,
): [number, number] {
  const poses = runtime.snapshot()!.poses!;
  const left = poses.get(doc.links.find((l) => l.name === "left-crank")!.id)!;
  const right = poses.get(doc.links.find((l) => l.name === "right-crank")!.id)!;
  return [left.angle, right.angle];
}

describe("createSimRuntime: multi-input (five-bar, two motors)", () => {
  it("enters ready with both motors driven", () => {
    const { store } = makeHarness();
    expect(store.getState().session?.status).toBe("ready");
    expect(store.getState().session?.drivenMotorCount).toBe(2);
  });

  it("play advances every motor along its own drive", () => {
    const { store, scheduler, runtime, doc } = makeHarness();
    const [left0, right0] = crankAngles(runtime, doc);

    runtime.play();
    for (let i = 0; i < 10; i++) scheduler.tick(16);

    expect(store.getState().playing).toBe(true);
    const [left, right] = crankAngles(runtime, doc);
    // left-motor speed +1, right-motor speed -1, for 0.16 s.
    expect(left - left0).toBeCloseTo(0.16, 6);
    expect(right - right0).toBeCloseTo(-0.16, 6);
    expect(store.getState().readout!.solver.status).toBe("ok");
  });

  it("step moves the first motor alone, holding the second", () => {
    const { runtime, doc } = makeHarness();
    const [left0, right0] = crankAngles(runtime, doc);

    runtime.step(1);

    const [left, right] = crankAngles(runtime, doc);
    expect(left - left0).toBeCloseTo(STEP_ROTARY, 9);
    expect(right - right0).toBeCloseTo(0, 9);
  });

  it("play continues from a stepped pose instead of jumping back", () => {
    const { scheduler, runtime, doc } = makeHarness();
    for (let i = 0; i < 5; i++) runtime.step(1);
    const [left0, right0] = crankAngles(runtime, doc);

    runtime.play();
    scheduler.tick(16);
    scheduler.tick(16);

    const [left, right] = crankAngles(runtime, doc);
    expect(left - left0).toBeCloseTo(0.032, 6);
    expect(right - right0).toBeCloseTo(-0.032, 6);
  });

  it("with loop off, a lock-up pauses and reverses the next play", () => {
    const base = buildFiveBar();
    // Both cranks turn outward: the distal links straighten and lock.
    const doc: MechanismDocument = {
      ...base,
      motors: [
        { ...base.motors[0], drive: { mode: "constant", speed: 1 } },
        { ...base.motors[1], drive: { mode: "constant", speed: -1 } },
      ],
    };
    const { store, scheduler, runtime } = makeHarness(doc);
    store.getState().setLoop(false);

    runtime.play();
    for (let i = 0; i < 2000 && store.getState().playing; i++) scheduler.tick(16);

    expect(store.getState().playing).toBe(false);
    expect(store.getState().readout!.lockUp).not.toBeNull();
    expect(store.getState().readout!.direction).toBe(-1);
  });

  it("with loop on, a lock-up reverses and keeps playing", () => {
    const { store, scheduler, runtime } = makeHarness();
    store.getState().setLoop(true);

    runtime.play();
    let reversed = false;
    for (let i = 0; i < 2000; i++) {
      scheduler.tick(16);
      if (store.getState().readout?.direction === -1) {
        reversed = true;
        break;
      }
    }

    expect(reversed).toBe(true);
    expect(store.getState().playing).toBe(true);
  });

  it("drag moves the end effector in both directions at once", () => {
    const { store, runtime, doc } = makeHarness();
    const distal = doc.links.find((l) => l.name === "left-distal")!;
    const P = fiveBarDims.P;

    expect(runtime.beginDrag({ linkId: distal.id, world: { x: P.x, y: P.y } })).toBe(true);
    // A 2-DOF mechanism can follow a pointer that moves diagonally.
    runtime.dragTo({ x: P.x + 3, y: P.y - 4 });
    runtime.endDrag();

    expect(store.getState().readout!.solver.status).toBe("ok");
    const pose = runtime.snapshot()!.poses!.get(distal.id)!;
    const length = Math.hypot(P.x - fiveBarDims.A.x, P.y - fiveBarDims.A.y);
    const [x, y] = pose.position;
    const end = { x: x + length * Math.cos(pose.angle), y: y + length * Math.sin(pose.angle) };
    expect(end.x).toBeCloseTo(P.x + 3, 3);
    expect(end.y).toBeCloseTo(P.y - 4, 3);
  });
});
