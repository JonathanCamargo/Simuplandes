/**
 * `createSimRuntime`: the one place that decides when to call which
 * Phase 3 / plan 05-02 / plan 05-03 function, and that pushes the results
 * into `simStore`. Pure orchestration -- no React here (`src/sim/react/`,
 * plan 05-04's other half, is the React glue that drives this from
 * `studioStore`'s mode and the mechanism document).
 *
 * Hot per-frame state (the compiled session, the current `SolvedState`,
 * playback direction, simulated time, the last bracketed lock-up, the live
 * time-history ring buffer, the active drag target, and every throttle
 * timestamp) lives in this factory's closure, NOT in `simStore` -- `simStore`
 * only ever receives the PUBLISHED results (`setPoses` every accepted frame,
 * `setReadout` throttled to at most once per `readoutIntervalMs`, plus
 * immediately on every discrete action: enter, pause, step, reset, scrub,
 * endDrag, and a lock-up/solver-failure stop). This split is what lets the
 * loop run at 60fps without forcing a React re-render every frame (the
 * canvas reads `poses` imperatively; only the throttled `readout` is ever
 * selected by a React component).
 *
 * Transport semantics (SIM-02):
 * - A full-rotation (Grashof) motor drives forward via `advanceDrive`;
 *   `loop=false` clamps the target to exactly one revolution from wherever
 *   `play()` was last called and pauses there.
 * - A bounded (non-Grashof / limited-travel) motor with `loop=true` drives
 *   via `advanceRocking`, which reverses direction at a lock-up internally
 *   (up to 2 reversals per call) -- this runtime just adopts
 *   `result.direction` afterward.
 * - A bounded motor with `loop=false` drives via `advanceDrive`; a `"locked"`
 *   result adopts the bracketed state, records the lock-up display value,
 *   flips `direction` (so the next `play()` reverses), and pauses.
 * - An expression-driven motor evaluates `evaluateDrivesAtTime(system,
 *   simTime)` every frame and resolves the target via `advanceDrive`; a
 *   lock-up pauses with no reversal (an expression's future value is
 *   whatever the expression says, not a rocking policy) -- the next
 *   `play()` eases from the scrubbed/locked pose back toward
 *   `value(simTime)` through the ordinary `advanceDrive` predictor/corrector,
 *   never a jump.
 *
 * Drag-to-drive (SIM-03) and trace/sweep publishing (SIM-04) are thin calls
 * into `drag.ts`/`sweep.ts`/`traces.ts`/`plots.ts`; this module owns none of
 * their numerics.
 */

import {
  advanceDrive,
  advanceRocking,
  evaluateDrivesAtTime,
  linkPose,
  solveVelocityAcceleration,
  type KinematicSystem,
  type SolvedState,
} from "../kinematics";
import { vec2, worldToLocal, type Vec2 } from "../geom";
import type { Id, MechanismDocument } from "../model";
import {
  createSimSession,
  inputDisplayValue,
  inputFromDisplay,
  type SimSession,
  type SimSessionSummary,
} from "./session";
import { posesFromState } from "./poses";
import { computeSweep } from "./sweep";
import { buildTraces, type TraceData } from "./traces";
import { dragToward, type DragTarget } from "./drag";
import {
  buildSweepTable,
  defaultQuantityIds,
  listQuantities,
  measureAll,
  TimeHistory,
  type MeasurementTable,
  type QuantityDef,
} from "./plots";
import type { SimReadout, SimStore, SolverReadoutStatus } from "./simStore";

/** One frame-scheduling abstraction: browsers use `requestAnimationFrame`; tests use a manual fake queue. */
export interface FrameScheduler {
  request(cb: (nowMs: number) => void): number;
  cancel(id: number): void;
  now(): number;
}

/** `requestAnimationFrame`/`cancelAnimationFrame`/`performance.now`, guarded so importing this module in node (tests, SSR) never throws. */
export const browserScheduler: FrameScheduler = {
  request(cb) {
    if (typeof requestAnimationFrame === "function") {
      return requestAnimationFrame(cb);
    }
    return setTimeout(() => cb(browserScheduler.now()), 16) as unknown as number;
  },
  cancel(id) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(id);
      return;
    }
    clearTimeout(id);
  },
  now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  },
};

/** The scrubber/step's rotary increment: 1 degree. A linear step is `system.lengthScale / 100`. */
export const STEP_ROTARY = Math.PI / 180;
/** The readout (and history-version bump) publish throttle. */
export const READOUT_INTERVAL_MS = 50;
/** The largest per-frame `dt` (seconds) ever fed to the solver, regardless of the real elapsed time (a tab coming back from background must not take one giant step). */
export const MAX_FRAME_DT_S = 0.1;

/** Everything Simulate mode's transport/drag/plot UI needs from the runtime. */
export interface SimRuntime {
  enter(doc: MechanismDocument): void;
  exit(): void;
  documentChanged(doc: MechanismDocument): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  step(direction?: 1 | -1): void;
  reset(): void;
  setSpeed(multiplier: number): void;
  setLoop(loop: boolean): void;
  scrubTo(display: number): void;
  beginDrag(grab: { linkId: Id; world: Vec2 }): boolean;
  dragTo(world: Vec2): void;
  endDrag(): void;
  getHistoryTable(): MeasurementTable | null;
  /** A fresh (unthrottled) snapshot for the dev-only test hook: the current relative input, its display value, and every link's world pose. */
  snapshot(): {
    input: number;
    display: number;
    poses: ReadonlyMap<Id, import("../model").Pose> | null;
  } | null;
  /** Idempotent and NON-terminal: stops the loop and runs `exit()`, but the runtime remains reusable (a later `enter()` works). React StrictMode's mount->cleanup->mount relies on this. */
  dispose(): void;
}

/** Options for `createSimRuntime`. */
export interface CreateSimRuntimeOptions {
  store: SimStore;
  /** Defaults to `browserScheduler`. */
  scheduler?: FrameScheduler;
  /** Defaults to `READOUT_INTERVAL_MS`. */
  readoutIntervalMs?: number;
}

/** How a driven motor's per-frame `delta` is produced. */
type DriveMode = "constant" | "expression";

/** The driven motor's per-frame drive classification: `speed` is the constant-mode rad/s (or length-units/s), always non-zero (defaults to 1 per the plan's own rule). Meaningless for `"expression"` mode. */
function classifyDrive(
  doc: MechanismDocument,
  summary: SimSessionSummary,
): { mode: DriveMode; speed: number } {
  if (summary.drivingMode === "motor" && summary.inputMotorId) {
    // `summary.inputMotorId` is always `doc.motors[0].id` for drivingMode
    // "motor" (session.ts's own contract, and `doc` here is the SAME
    // document `createSimSession` classified) -- the lookup can't miss.
    const motor = doc.motors.find((m) => m.id === summary.inputMotorId)!;
    if (motor.drive.mode === "constant") {
      const speed = motor.drive.speed;
      return { mode: "constant", speed: speed !== 0 ? speed : 1 };
    }
    return { mode: "expression", speed: 1 };
  }
  // "temporary" (always a constant, speed-1 synthetic driver) or "none".
  return { mode: "constant", speed: 1 };
}

/** The two link indices the driven joint connects, for `defaultQuantityIds`'s "not an input link" rule. `[]` with no driven input. */
function inputLinkIndicesOf(system: KinematicSystem, motorIndex: number): number[] {
  for (const c of system.constraints) {
    if (c.kind === "rotary-driver" && c.motorIndex === motorIndex) return [c.linkA, c.linkB];
    if (c.kind === "linear-driver" && c.motorIndex === motorIndex) {
      return [c.a.linkIndex, c.b.linkIndex];
    }
  }
  return [];
}

/** `createSimRuntime(opts)`: the rAF simulation loop and every transport/drag operation, backed by an injectable `FrameScheduler`. */
export function createSimRuntime(opts: CreateSimRuntimeOptions): SimRuntime {
  const store = opts.store;
  const scheduler = opts.scheduler ?? browserScheduler;
  const readoutIntervalMs = opts.readoutIntervalMs ?? READOUT_INTERVAL_MS;

  let entered = false;
  let session: SimSession | null = null;
  let state: SolvedState | null = null;
  let direction: 1 | -1 = 1;
  let simTime = 0;
  let playStartInput = 0;
  let lockUp: { display: number } | null = null;
  let history: TimeHistory | null = null;
  let quantities: readonly QuantityDef[] = [];
  let dragTarget: DragTarget | null = null;
  let driveMode: DriveMode = "constant";
  let motorSpeed = 1;

  let ratesBuf = new Float64Array(0);
  let accelsBuf = new Float64Array(0);
  let measureRow = new Float64Array(0);

  let lastSolverStatus: SolverReadoutStatus = "ok";
  let lastResidualNorm = 0;
  let lastNearSingular = false;

  let frameHandle: number | null = null;
  let lastFrameMs: number | null = null;
  let lastReadoutMs: number | null = null;
  let lastHistoryBumpMs: number | null = null;

  function cancelFrame(): void {
    if (frameHandle !== null) {
      scheduler.cancel(frameHandle);
      frameHandle = null;
    }
  }

  function scheduleFrame(): void {
    frameHandle = scheduler.request(frameTick);
  }

  function currentReadout(): SimReadout | null {
    if (!session || !state) return null;
    const motorIndex = session.motorIndex;
    const input = motorIndex >= 0 ? state.inputs[motorIndex] : 0;
    const display = inputDisplayValue(session.summary, store.getState().range, input);
    return {
      input,
      display,
      time: simTime,
      direction,
      lockUp,
      nearSingular: lastNearSingular,
      solver: { status: lastSolverStatus, residualNorm: lastResidualNorm },
    };
  }

  function maybePublishReadout(nowMs: number, force: boolean): void {
    if (force || lastReadoutMs === null || nowMs - lastReadoutMs >= readoutIntervalMs) {
      store.getState().setReadout(currentReadout());
      lastReadoutMs = nowMs;
    }
  }

  function publishReadoutForce(): void {
    const now = scheduler.now();
    store.getState().setReadout(currentReadout());
    lastReadoutMs = now;
  }

  /** Runs after every accepted (or rejected-but-recorded) solve: updates the reused rate/accel/measurement buffers, pushes one history row, publishes poses, and throttles both the history-version bump and the readout. */
  function recordFrame(
    status: SolverReadoutStatus,
    residualNorm: number,
    nearSingular: boolean,
    rate: number,
    accel: number,
    nowMs: number,
    forceReadout: boolean,
  ): void {
    lastSolverStatus = status;
    lastResidualNorm = residualNorm;
    lastNearSingular = nearSingular;
    // Every call site (stepSimulation, step, reset, scrubTo, dragTo) already
    // confirmed `session.system`/`state` are non-null before calling here,
    // and `ratesBuf`/`accelsBuf`/`measureRow`/`history` are always sized to
    // match `session.system` by `buildSessionFor` (the only place they're
    // allocated) -- so these are trusted, not re-checked.
    const system = session!.system!;
    const currentState = state!;
    const motorIndex = session!.motorIndex;

    ratesBuf.fill(0);
    accelsBuf.fill(0);
    if (motorIndex >= 0) {
      ratesBuf[motorIndex] = rate;
      accelsBuf[motorIndex] = accel;
    }

    const rateResult = solveVelocityAcceleration(system, currentState.q, ratesBuf, accelsBuf);
    measureAll(system, currentState.q, rateResult.qDot, rateResult.qDDot, quantities, measureRow);
    history!.push(simTime, measureRow);

    store.getState().setPoses(posesFromState(system, currentState.q));

    const bumpDue = lastHistoryBumpMs === null || nowMs - lastHistoryBumpMs >= readoutIntervalMs;
    if (bumpDue) {
      store.getState().bumpHistoryVersion();
      lastHistoryBumpMs = nowMs;
    }

    maybePublishReadout(nowMs, forceReadout);
  }

  /** True while `play`/`step`/`scrubTo` are permitted: a real motor (not a temporary driver, not not-drivable). */
  function canDrive(): boolean {
    return (
      !!session &&
      !!state &&
      session.summary.status === "ready" &&
      session.summary.drivingMode === "motor"
    );
  }

  function stopPlaybackIfAny(): void {
    if (store.getState().playing) {
      cancelFrame();
      store.getState().setPlaying(false);
    }
  }

  function stepSimulation(dt: number, nowMs: number): void {
    // Only ever invoked from `frameTick` while `playing` is true, which
    // `play()` only sets after `canDrive()` passed -- so `session.system`,
    // `state` and a non-negative `motorIndex` are already guaranteed here.
    const system = session!.system!;
    const motorIndex = session!.motorIndex;

    const range = store.getState().range;
    const loop = store.getState().loop;

    let status: SolverReadoutStatus;
    let residualNorm = 0;
    let nearSingular = false;
    let rate = 0;
    let accel = 0;
    let shouldPause = false;

    if (driveMode === "expression") {
      simTime += dt;
      const evalResult = evaluateDrivesAtTime(system, simTime);
      if (!evalResult.ok) {
        status = "invalid-input";
        shouldPause = true;
      } else {
        const target = Float64Array.from(state!.inputs);
        target[motorIndex] = evalResult.values[motorIndex];
        const stepResult = advanceDrive(system, state!, target);
        state = stepResult.state;
        status = stepResult.status;
        residualNorm = stepResult.residualNorm;
        nearSingular = stepResult.singularity.nearSingular;
        rate = evalResult.rates[motorIndex];
        accel = evalResult.accels[motorIndex];
        if (status === "locked") {
          lockUp = {
            display: inputDisplayValue(session!.summary, range, state.inputs[motorIndex]),
          };
          shouldPause = true;
        } else if (status !== "ok") {
          shouldPause = true;
        } else {
          lockUp = null;
        }
      }
    } else {
      simTime += dt;
      const delta = Math.abs(motorSpeed) * dt;
      const isFullRotation = !!range?.fullRotation;

      if (isFullRotation) {
        // Full-rotation play never reverses `direction` (only the bounded
        // branches below do): it's always +1 here, so the limit is always
        // `playStartInput + 2*PI` ahead, never behind.
        let targetInput = state!.inputs[motorIndex] + direction * delta;
        let reachesLimit = false;
        if (!loop) {
          const limit = playStartInput + direction * 2 * Math.PI;
          if (targetInput >= limit) {
            targetInput = limit;
            reachesLimit = true;
          }
        }
        const target = Float64Array.from(state!.inputs);
        target[motorIndex] = targetInput;
        const stepResult = advanceDrive(system, state!, target);
        state = stepResult.state;
        status = stepResult.status;
        residualNorm = stepResult.residualNorm;
        nearSingular = stepResult.singularity.nearSingular;
        rate = direction * motorSpeed;
        lockUp = null;
        if (status !== "ok" || reachesLimit) shouldPause = true;
      } else if (loop) {
        const rockResult = advanceRocking(system, state!, motorIndex, delta, direction);
        state = rockResult.state;
        direction = rockResult.direction;
        status = rockResult.status;
        residualNorm = rockResult.residualNorm;
        nearSingular = rockResult.singularity.nearSingular;
        rate = direction * motorSpeed;
        lockUp = null;
        if (status === "no-convergence" || status === "invalid-input") shouldPause = true;
      } else {
        const targetInput = state!.inputs[motorIndex] + direction * delta;
        const target = Float64Array.from(state!.inputs);
        target[motorIndex] = targetInput;
        const stepResult = advanceDrive(system, state!, target);
        state = stepResult.state;
        status = stepResult.status;
        residualNorm = stepResult.residualNorm;
        nearSingular = stepResult.singularity.nearSingular;
        rate = direction * motorSpeed;
        if (status === "locked") {
          lockUp = {
            display: inputDisplayValue(session!.summary, range, state.inputs[motorIndex]),
          };
          direction = direction === 1 ? -1 : 1;
          shouldPause = true;
        } else if (status !== "ok") {
          shouldPause = true;
        } else {
          lockUp = null;
        }
      }
    }

    if (shouldPause) store.getState().setPlaying(false);
    recordFrame(status, residualNorm, nearSingular, rate, accel, nowMs, shouldPause);
  }

  function frameTick(nowMs: number): void {
    frameHandle = null;
    if (!entered || !store.getState().playing) return;
    const last = lastFrameMs ?? nowMs;
    const rawDt = Math.max(0, (nowMs - last) / 1000);
    const dt = Math.min(rawDt, MAX_FRAME_DT_S) * store.getState().speed;
    lastFrameMs = nowMs;

    stepSimulation(dt, nowMs);

    if (store.getState().playing) {
      scheduleFrame();
    }
  }

  function buildSessionFor(doc: MechanismDocument): void {
    const newSession = createSimSession(doc);
    session = newSession;
    state = newSession.start
      ? {
          q: Float64Array.from(newSession.start.q),
          inputs: Float64Array.from(newSession.start.inputs),
        }
      : null;
    direction = 1;
    simTime = 0;
    lockUp = null;
    dragTarget = null;
    lastFrameMs = null;
    lastReadoutMs = null;
    lastHistoryBumpMs = null;
    lastSolverStatus = "ok";
    lastResidualNorm = 0;
    lastNearSingular = false;
    driveMode = "constant";
    motorSpeed = 1;
    history = null;
    quantities = [];
    ratesBuf = new Float64Array(0);
    accelsBuf = new Float64Array(0);
    measureRow = new Float64Array(0);

    let range = null as ReturnType<SimStore["getState"]>["range"];
    let traces: TraceData[] = [];
    let sweepTable: MeasurementTable | null = null;

    if (newSession.system) {
      quantities = listQuantities(newSession.system);
      ratesBuf = new Float64Array(newSession.system.motors.length);
      accelsBuf = new Float64Array(newSession.system.motors.length);
      measureRow = new Float64Array(quantities.length);
      history = new TimeHistory(quantities.length);
    }

    if (
      newSession.system &&
      newSession.start &&
      newSession.motorIndex >= 0 &&
      newSession.summary.status === "ready"
    ) {
      const drive = classifyDrive(doc, newSession.summary);
      driveMode = drive.mode;
      motorSpeed = drive.speed;

      const sweep = computeSweep(newSession.system, newSession.start, newSession.motorIndex, {
        inputRate: drive.speed,
      });
      range =
        sweep.kind === "none"
          ? null
          : {
              min: sweep.inputMin,
              max: sweep.inputMax,
              fullRotation: sweep.kind === "full-rotation",
            };
      traces = buildTraces(newSession.system, sweep);
      // `inputKind` is only ever null for drivingMode "none", which never
      // reaches "ready" (classifyDrivability), so it's always set here.
      sweepTable = buildSweepTable(newSession.system, quantities, sweep.samples, {
        inputKind: newSession.summary.inputKind!,
        inputDisplayOffset: newSession.summary.inputDisplayOffset,
      });

      const validIds = new Set(quantities.map((q) => q.id));
      const currentIds = store.getState().plot.quantityIds;
      const stillValid = currentIds.length > 0 && currentIds.every((id) => validIds.has(id));
      if (!stillValid) {
        const inputLinks = inputLinkIndicesOf(newSession.system, newSession.motorIndex);
        store.getState().setPlotQuantities(defaultQuantityIds(newSession.system, inputLinks));
      }
    }

    store.getState().setSession(newSession.summary, range);
    store.getState().setSweepData({ traces, sweepTable, quantities });
    store.getState().setPlaying(false);
    store.getState().setDragging(null);

    const poses = newSession.system
      ? posesFromState(newSession.system, state ? state.q : newSession.system.q0)
      : null;
    store.getState().setPoses(poses);
    store.getState().setReadout(currentReadout());
    lastReadoutMs = scheduler.now();
  }

  function enter(doc: MechanismDocument): void {
    cancelFrame();
    entered = true;
    buildSessionFor(doc);
  }

  function documentChanged(doc: MechanismDocument): void {
    if (!entered) return;
    if (session && session.document === doc) return;
    cancelFrame();
    buildSessionFor(doc);
  }

  function exit(): void {
    cancelFrame();
    entered = false;
    session = null;
    state = null;
    quantities = [];
    history = null;
    dragTarget = null;
    lockUp = null;
    direction = 1;
    simTime = 0;
    lastFrameMs = null;
    lastReadoutMs = null;
    lastHistoryBumpMs = null;
    store.getState().clear();
  }

  function play(): void {
    if (!entered || !canDrive()) return;
    if (store.getState().playing) return;
    playStartInput = state!.inputs[session!.motorIndex];
    lastFrameMs = scheduler.now();
    store.getState().setPlaying(true);
    scheduleFrame();
  }

  function pause(): void {
    if (!store.getState().playing) return;
    cancelFrame();
    store.getState().setPlaying(false);
    publishReadoutForce();
  }

  function togglePlay(): void {
    if (store.getState().playing) {
      pause();
    } else {
      play();
    }
  }

  function step(dir: 1 | -1 = 1): void {
    if (!canDrive()) return;
    stopPlaybackIfAny();
    const system = session!.system!;
    const motorIndex = session!.motorIndex;
    const motor = system.motors[motorIndex];
    const stepSize = motor.kind === "rotary" ? STEP_ROTARY : system.lengthScale / 100;
    const target = Float64Array.from(state!.inputs);
    target[motorIndex] += dir * stepSize;
    const result = advanceDrive(system, state!, target);
    state = result.state;
    if (result.status === "locked") {
      lockUp = {
        display: inputDisplayValue(
          session!.summary,
          store.getState().range,
          state.inputs[motorIndex],
        ),
      };
    } else if (result.status === "ok") {
      lockUp = null;
    }
    recordFrame(
      result.status,
      result.residualNorm,
      result.singularity.nearSingular,
      0,
      0,
      scheduler.now(),
      true,
    );
  }

  function reset(): void {
    if (!session || !session.start || !session.system) return;
    stopPlaybackIfAny();
    state = {
      q: Float64Array.from(session.start.q),
      inputs: Float64Array.from(session.start.inputs),
    };
    simTime = 0;
    direction = 1;
    lockUp = null;
    history?.clear();
    store.getState().bumpHistoryVersion();
    recordFrame("ok", 0, false, 0, 0, scheduler.now(), true);
  }

  function setSpeed(multiplier: number): void {
    store.getState().setSpeed(multiplier);
  }

  function setLoop(loop: boolean): void {
    store.getState().setLoop(loop);
  }

  function scrubTo(display: number): void {
    if (!canDrive()) return;
    stopPlaybackIfAny();
    const system = session!.system!;
    const motorIndex = session!.motorIndex;
    const range = store.getState().range;
    const targetValue = inputFromDisplay(
      session!.summary,
      range,
      display,
      state!.inputs[motorIndex],
    );
    const target = Float64Array.from(state!.inputs);
    target[motorIndex] = targetValue;
    const result = advanceDrive(system, state!, target);
    state = result.state;
    if (result.status === "locked") {
      lockUp = { display: inputDisplayValue(session!.summary, range, state.inputs[motorIndex]) };
    } else if (result.status === "ok") {
      lockUp = null;
    }
    recordFrame(
      result.status,
      result.residualNorm,
      result.singularity.nearSingular,
      0,
      0,
      scheduler.now(),
      true,
    );
  }

  function beginDrag(grab: { linkId: Id; world: Vec2 }): boolean {
    if (!entered || !session?.system || !state) return false;
    if (session.summary.status !== "ready") return false;
    const linkIndex = session.system.linkIndexById.get(grab.linkId);
    if (linkIndex === undefined) return false;
    if (session.system.links[linkIndex].isGround) return false;

    stopPlaybackIfAny();
    const pose = linkPose(session.system, state.q, linkIndex);
    const local = worldToLocal(grab.world, vec2(pose.x, pose.y), pose.angle);
    dragTarget = { linkIndex, local: { x: local.x, y: local.y } };
    store.getState().setDragging({ linkId: grab.linkId });
    publishReadoutForce();
    return true;
  }

  function dragTo(world: Vec2): void {
    if (!dragTarget || !session?.system || !state) return;
    const result = dragToward(session.system, state, dragTarget, world);
    state = result.state;
    const range = store.getState().range;
    const motorIndex = session.motorIndex;
    if (result.status === "locked" && motorIndex >= 0) {
      lockUp = { display: inputDisplayValue(session.summary, range, state.inputs[motorIndex]) };
    } else if (result.status === "ok") {
      lockUp = null;
    }
    const mappedStatus: SolverReadoutStatus =
      result.status === "singular" ? "no-convergence" : result.status;
    recordFrame(
      mappedStatus,
      result.residualNorm,
      result.nearSingular,
      0,
      0,
      scheduler.now(),
      true,
    );
  }

  function endDrag(): void {
    if (!dragTarget) return;
    dragTarget = null;
    store.getState().setDragging(null);
    publishReadoutForce();
  }

  function getHistoryTable(): MeasurementTable | null {
    if (!history) return null;
    return history.toTable(quantities);
  }

  function snapshot(): {
    input: number;
    display: number;
    poses: ReadonlyMap<Id, import("../model").Pose> | null;
  } | null {
    if (!session || !state) return null;
    const motorIndex = session.motorIndex;
    const input = motorIndex >= 0 ? state.inputs[motorIndex] : 0;
    const display = inputDisplayValue(session.summary, store.getState().range, input);
    const poses = session.system ? posesFromState(session.system, state.q) : null;
    return { input, display, poses };
  }

  function dispose(): void {
    exit();
  }

  return {
    enter,
    exit,
    documentChanged,
    play,
    pause,
    togglePlay,
    step,
    reset,
    setSpeed,
    setLoop,
    scrubTo,
    beginDrag,
    dragTo,
    endDrag,
    getHistoryTable,
    snapshot,
    dispose,
  };
}
