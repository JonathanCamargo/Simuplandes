/**
 * Per-marker coupler-curve traces (SIM-04), built from a `computeSweep`
 * result: one `TraceData` per `system.markers` entry, in `system.markers`
 * order. This module never calls `advanceDrive`/`solvePosition` itself --
 * every pose comes from the sweep's own already-solved samples, read via
 * `pointKinematics` (the same query every other per-frame consumer uses).
 *
 * A trace is `closed` exactly when the sweep completed a full rotation AND
 * the first and last sampled points coincide within `1e-6 * lengthScale`
 * -- meaningful because `advanceDrive` preserves the assembly branch
 * throughout a sweep (KIN-04), so a full rotation returning to the exact
 * same input necessarily returns to the exact same pose, not some other
 * branch's pose at the same input.
 */

import { pointKinematics, type KinematicSystem } from "../kinematics";
import type { SweepResult } from "./sweep";

/** One marker's coupler curve: `points` is interleaved `[x0, y0, x1, y1, ...]`, length `2 * samples.length`. */
export interface TraceData {
  readonly markerId: string;
  readonly label: string;
  readonly points: Float64Array;
  readonly closed: boolean;
}

const CLOSE_TOLERANCE_FACTOR = 1e-6;

/** Builds one `TraceData` per `system.markers` entry from `sweep`'s solved samples. `[]` with no markers. */
export function buildTraces(system: KinematicSystem, sweep: SweepResult): TraceData[] {
  if (system.markers.length === 0) return [];

  const closeThreshold = CLOSE_TOLERANCE_FACTOR * system.lengthScale;

  return system.markers.map((marker) => {
    const points = new Float64Array(sweep.samples.length * 2);
    for (let i = 0; i < sweep.samples.length; i++) {
      const sample = sweep.samples[i];
      const pk = pointKinematics(
        system,
        sample.q,
        sample.qDot,
        sample.qDDot,
        marker.linkIndex,
        marker.local,
      );
      points[i * 2] = pk.position.x;
      points[i * 2 + 1] = pk.position.y;
    }

    let closed = false;
    if (sweep.kind === "full-rotation" && sweep.samples.length >= 2) {
      const dx = points[points.length - 2] - points[0];
      const dy = points[points.length - 1] - points[1];
      closed = Math.hypot(dx, dy) <= closeThreshold;
    }

    return { markerId: marker.id, label: marker.label, points, closed };
  });
}
