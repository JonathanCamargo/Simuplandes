/**
 * Turns a compiled `KinematicSystem` + `q` into the per-link world poses the
 * canvas renders. Pure: one `linkPose` call per link, ground included (a
 * ground link's pose is its fixed reference pose, from `linkPose` itself).
 */

import { linkPose, type KinematicSystem } from "../kinematics";
import type { Id, Pose } from "../model";

/**
 * Every link's world pose at `q`, keyed by link id. Ground links are
 * included (their pose never moves). One entry per `system.links` element.
 */
export function posesFromState(system: KinematicSystem, q: Float64Array): Map<Id, Pose> {
  const poses = new Map<Id, Pose>();
  system.links.forEach((link, linkIndex) => {
    const { x, y, angle } = linkPose(system, q, linkIndex);
    poses.set(link.id, { position: [x, y], angle });
  });
  return poses;
}

/** How many sweep samples `sampleSweepPoses` keeps at most. Enough to bound the motion; cheap to publish. */
export const SWEEP_POSE_SAMPLES = 48;

/**
 * Link poses at up to `maxSamples` evenly spaced entries of `samples` (first
 * and last always included): the space the mechanism sweeps through, for
 * framing the view. `[]` when there are no samples.
 */
export function sampleSweepPoses(
  system: KinematicSystem,
  samples: readonly { readonly q: Float64Array }[],
  maxSamples = SWEEP_POSE_SAMPLES,
): Map<Id, Pose>[] {
  if (samples.length === 0) return [];
  const count = Math.min(samples.length, Math.max(2, maxSamples));
  const picked: Map<Id, Pose>[] = [];
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.round((i * (samples.length - 1)) / (count - 1));
    picked.push(posesFromState(system, samples[index].q));
  }
  return picked;
}
