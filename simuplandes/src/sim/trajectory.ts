/**
 * `Trajectory`: the pre-integrated forward-dynamics buffer that Dynamics
 * mode plays and scrubs. Unlike kinematics, a dynamic pose depends on the
 * whole history, so time cannot be jumped to: the runtime integrates ahead
 * a few frames per animation tick (`compute`), and playback and scrubbing
 * only ever read frames that already exist.
 *
 * Every recorded frame also stores its measurement row (kinematic
 * quantities plus reactions, efforts, springs and energy), so the plot
 * table is just a copy of what is already there.
 */

import { evaluateDrivesAtTime, linkPose, type KinematicSystem } from "../kinematics";
import {
  advance,
  describeFrame,
  forwardDynamics,
  DEFAULT_MAX_STEP,
  type DynamicState,
  type DynamicSystem,
  type StepStatus,
} from "../dynamics";
import { measureAll, unwrapDegrees, type MeasurementTable, type QuantityDef } from "./plots";
import type { TraceData } from "./traces";

/** Recorded frames per simulated second. */
export const DYNAMICS_FRAME_RATE = 60;

export interface TrajectoryOptions {
  /** Simulated seconds to integrate. */
  readonly duration: number;
  /** Seconds between recorded frames. Default `1 / DYNAMICS_FRAME_RATE`. */
  readonly frameInterval?: number;
  /** Largest integration step, seconds. Default `DEFAULT_MAX_STEP`. */
  readonly maxStep?: number;
}

export type TrajectoryStatus = "computing" | "complete" | "stopped";

/** Why integration stopped early, and when. */
export interface TrajectoryStop {
  readonly reason: Exclude<StepStatus, "ok">;
  readonly time: number;
  readonly motorId: string | null;
}

export class Trajectory {
  readonly duration: number;
  readonly frameInterval: number;
  private readonly maxStep: number;
  private readonly frames: DynamicState[] = [];
  private readonly singularFrames: boolean[] = [];
  private rows: Float64Array;
  private readonly row: Float64Array;
  private current: DynamicState;
  private currentStatus: TrajectoryStatus = "computing";
  private stopInfo: TrajectoryStop | null = null;

  constructor(
    readonly system: KinematicSystem,
    readonly dynamics: DynamicSystem,
    start: DynamicState,
    readonly quantities: readonly QuantityDef[],
    options: TrajectoryOptions,
  ) {
    this.duration = options.duration;
    this.frameInterval = options.frameInterval ?? 1 / DYNAMICS_FRAME_RATE;
    this.maxStep = options.maxStep ?? DEFAULT_MAX_STEP;
    this.row = new Float64Array(quantities.length);
    this.rows = new Float64Array(64 * quantities.length);
    this.current = start;
    this.record(start, false);
    if (this.duration <= 0) this.currentStatus = "complete";
  }

  get status(): TrajectoryStatus {
    return this.currentStatus;
  }

  get stop(): TrajectoryStop | null {
    return this.stopInfo;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /** Simulated time of the last recorded frame. */
  get computedTime(): number {
    return this.frames[this.frames.length - 1].t;
  }

  /** True when any recorded frame met a singular solve (redundant constraints, or a massless free coordinate). */
  get singular(): boolean {
    return this.singularFrames.some((flag) => flag);
  }

  /** Integrates up to `maxFrames` more frames. Returns how many were added. */
  compute(maxFrames: number): number {
    let added = 0;
    while (added < maxFrames && this.currentStatus === "computing") {
      const remaining = this.duration - this.current.t;
      const interval = Math.min(this.frameInterval, remaining);
      const result = advance(this.dynamics, this.current, interval, this.maxStep);
      if (result.status !== "ok") {
        this.currentStatus = "stopped";
        this.stopInfo = {
          reason: result.status,
          time: this.current.t,
          motorId: result.motorId,
        };
        break;
      }
      this.current = result.state;
      this.record(result.state, result.singular);
      added++;
      if (this.duration - this.current.t <= 1e-9) this.currentStatus = "complete";
    }
    return added;
  }

  /** The recorded frame index at or before `time` (clamped to the recorded range). */
  indexAt(time: number): number {
    const index = Math.floor(time / this.frameInterval + 1e-9);
    return Math.min(Math.max(index, 0), this.frames.length - 1);
  }

  /** The recorded state at frame `index`. */
  frame(index: number): DynamicState {
    return this.frames[index];
  }

  /** Whether frame `index` met a singular solve. */
  frameSingular(index: number): boolean {
    return this.singularFrames[index];
  }

  /** Every recorded frame as a time table, angle columns unwrapped. */
  table(): MeasurementTable {
    const length = this.frames.length;
    const count = this.quantities.length;
    const x = new Float64Array(length);
    const columns = this.quantities.map(() => new Float64Array(length));
    for (let i = 0; i < length; i++) {
      x[i] = this.frames[i].t;
      for (let j = 0; j < count; j++) columns[j][i] = this.rows[i * count + j];
    }
    this.quantities.forEach((quantity, j) => {
      if (quantity.token === "angle") unwrapDegrees(columns[j]);
    });
    return { xKind: "time", xUnit: "s", x, quantities: this.quantities, columns, length };
  }

  /** Each marker's path over the recorded frames. */
  traces(): TraceData[] {
    return this.system.markers.map((marker) => {
      const points = new Float64Array(this.frames.length * 2);
      this.frames.forEach((state, i) => {
        const pose = linkPose(this.system, state.q, marker.linkIndex);
        const c = Math.cos(pose.angle);
        const s = Math.sin(pose.angle);
        points[i * 2] = pose.x + marker.local.x * c - marker.local.y * s;
        points[i * 2 + 1] = pose.y + marker.local.x * s + marker.local.y * c;
      });
      return { markerId: marker.id, label: marker.label, points, closed: false };
    });
  }

  private record(state: DynamicState, singular: boolean): void {
    const drives = evaluateDrivesAtTime(this.system, state.t);
    const solution = forwardDynamics(this.dynamics, state.t, state.q, state.v, drives.accels);
    const frame =
      solution.status === "ok"
        ? describeFrame(this.dynamics, state.t, state.q, state.v, solution.lambda)
        : null;
    measureAll(this.system, state.q, state.v, solution.qDDot, this.quantities, this.row, frame);
    const count = this.quantities.length;
    const index = this.frames.length;
    if ((index + 1) * count > this.rows.length) {
      const grown = new Float64Array(this.rows.length * 2);
      grown.set(this.rows);
      this.rows = grown;
    }
    this.rows.set(this.row, index * count);
    this.frames.push(state);
    this.singularFrames.push(singular || solution.singular);
  }
}
