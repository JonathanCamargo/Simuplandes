/**
 * Cheap travel gate for auto-layout (09-02). Builds the candidate document,
 * compiles the kinematic system (no `createSimSession`: that costs
 * ~130-250 ms and is reserved for the winning candidate), checks Gruebler
 * mobility, then marches the driven input in small steps from the reference
 * pose (forward, then backward) with an early exit at the goal.
 */

import { buildStudioDocument } from "../interchange/buildDocument";
import type { LayoutRequest, Vec2Tuple } from "../interchange/importReport";
import {
  advanceDrive,
  analyzeMobility,
  compileSystem,
  grueblerMobility,
  referenceState,
  type KinematicSystem,
  type SolvedState,
} from "../kinematics";

const DEG = Math.PI / 180;

/** Default rotary march step (2 degrees). */
export const RANGE_STEP_RAD = 2 * DEG;
/** Linear-input march step and goal (model units); the goal is scaled to the rotary goal by the caller. */
export const LINEAR_STEP = 2;
export const LINEAR_GOAL = 50;

export interface CandidateMeasure {
  readonly gruebler: number | null;
  /** Instantaneous rank DOF at the reference pose (null when not computed). */
  readonly rankDof: number | null;
  /** Reachable input travel in degrees (linear inputs are scaled so `LINEAR_GOAL` units = `goalDeg`). */
  readonly rangeDeg: number;
}

/**
 * Reachable input travel (input units) from `start`: marches `step` at a time
 * forward then backward, stops early once `goal` is reached, counts a
 * partial step at a lock-up, and stops on any non-ok status.
 */
export function inputRange(
  system: KinematicSystem,
  start: SolvedState,
  motorIndex: number,
  goal: number,
  step: number = RANGE_STEP_RAD,
): number {
  let total = 0;
  for (const sign of [1, -1] as const) {
    let state = start;
    let travelled = 0;
    while (travelled < goal) {
      const target = Float64Array.from(state.inputs);
      target[motorIndex] += sign * step;
      const result = advanceDrive(system, state, target, { tolerance: 1e-9 });
      if (result.status === "locked") {
        travelled += Math.abs(result.state.inputs[motorIndex] - state.inputs[motorIndex]);
        break;
      }
      if (result.status !== "ok") break;
      state = result.state;
      travelled += step;
    }
    total += travelled;
    if (total >= goal) break;
  }
  return total;
}

/** GraphThe convention: among node 0's ascending neighbours the first of degree 2, else the first. Returns an edge index or null. */
export function conventionInputEdge(req: LayoutRequest): number | null {
  const degree = new Array<number>(req.nodeCount).fill(0);
  const neighbours = new Map<number, number>(); // neighbour -> first edge index
  req.edges.forEach((e, i) => {
    degree[e.u] += 1;
    degree[e.v] += 1;
    if (e.u === 0 || e.v === 0) {
      const other = e.u === 0 ? e.v : e.u;
      if (!neighbours.has(other)) neighbours.set(other, i);
    }
  });
  const sorted = [...neighbours.keys()].sort((a, b) => a - b);
  const pick = sorted.find((n) => degree[n] === 2) ?? sorted[0];
  return pick === undefined ? null : (neighbours.get(pick) ?? null);
}

/**
 * Measures one candidate layout: builds the studio document (motor on
 * `req.inputEdge`, else the convention edge), compiles it and returns the
 * Gruebler number and reachable range. Any build/compile failure -> range 0.
 * A Gruebler number other than 1 short-circuits with range 0.
 */
export function measureCandidate(
  req: LayoutRequest,
  positions: readonly Vec2Tuple[],
  goalDeg: number = 75,
): CandidateMeasure {
  try {
    const inputEdge = req.inputEdge ?? conventionInputEdge(req);
    const doc = buildStudioDocument({
      name: "layout",
      units: null,
      nodeCount: req.nodeCount,
      linkNames: new Array<null>(req.nodeCount).fill(null),
      edges: req.edges.map((e, i) => ({ ...e, pos: positions[i] })),
      inputEdge,
      markers: [],
    });
    const system = compileSystem(doc);
    const { gruebler } = grueblerMobility(system);
    if (gruebler !== 1 || system.motors.length !== 1) {
      return { gruebler, rankDof: null, rangeDeg: 0 };
    }
    // A degenerate pose can satisfy Gruebler yet have rank DOF > 1 (dependent
    // constraints): the march would still look fine, but it is not drivable.
    const { rankDof } = analyzeMobility(system);
    if (rankDof !== 1) return { gruebler, rankDof, rangeDeg: 0 };
    const linear = system.motors[0].kind === "linear";
    const start = referenceState(system);
    if (linear) {
      const travel = inputRange(system, start, 0, LINEAR_GOAL, LINEAR_STEP);
      return { gruebler, rankDof, rangeDeg: (travel / LINEAR_GOAL) * goalDeg };
    }
    const range = inputRange(system, start, 0, goalDeg * DEG);
    return { gruebler, rankDof, rangeDeg: range / DEG };
  } catch {
    return { gruebler: null, rankDof: null, rangeDeg: 0 };
  }
}
