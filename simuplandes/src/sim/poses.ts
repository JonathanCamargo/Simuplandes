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
