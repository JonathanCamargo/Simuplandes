/**
 * Mobility diagnostics: Gruebler's count-based formula and the Jacobian's
 * numerical rank, reported separately (D5) -- they legitimately differ for
 * structurally redundant topologies (e.g. a double parallelogram, Gruebler 0
 * yet mobile) and at singular poses (e.g. that same mechanism at 0/180
 * degrees, where every pin is collinear). Phase 5's DOF badge shows
 * Gruebler and explains a mismatch using the rank numbers below (research
 * Pitfall 2: never derive one from the other).
 */

import { evalJacobian } from "./constraints";
import { numericalRank } from "./linalg";
import type { KinematicSystem } from "./system";

/** Gruebler's planar mobility formula, with every ground link merged into one frame. */
export interface GrueblerReport {
  readonly gruebler: number;
  readonly linkCount: number;
  readonly jointCount: number;
  readonly groundLinkCount: number;
}

/** Gruebler F, Jacobian-rank DOF, redundant-constraint count and driven DOF, at a pose. */
export interface MobilityReport {
  readonly gruebler: number;
  readonly linkCount: number;
  readonly jointCount: number;
  readonly groundLinkCount: number;
  readonly rankDof: number;
  readonly redundantConstraints: number;
  readonly motorCount: number;
  readonly drivenDof: number;
}

/**
 * `F = 3*(linkCount - 1) - 2*jointCount`. Every joint (R or P) is a 1-DOF
 * lower pair, so `jointCount` alone (not a per-kind weighting) drives the
 * formula. Every `isGround` link is merged into a single frame link, so a
 * document authored with several ground links (e.g. one per pivot) still
 * counts as one link here.
 */
export function grueblerMobility(system: KinematicSystem): GrueblerReport {
  let groundLinkCount = 0;
  let movingLinkCount = 0;
  for (const slot of system.links) {
    if (slot.isGround) groundLinkCount++;
    else movingLinkCount++;
  }
  const linkCount = movingLinkCount + (groundLinkCount > 0 ? 1 : 0);
  const jointCount = system.jointRows / 2;
  const gruebler = 3 * (linkCount - 1) - 2 * jointCount;
  return { gruebler, linkCount, jointCount, groundLinkCount };
}

/**
 * Gruebler (a topology count, independent of pose) versus the Jacobian's
 * numerical rank (an instantaneous fact about `q`) -- two separate numbers,
 * never derived from one another (D5). `rankDof`/`redundantConstraints`
 * come from the joint-rows-only Jacobian (motors excluded); `drivenDof`
 * folds the driver rows in too (0 means fully driven at this pose).
 * Allocates fresh Jacobian buffers -- this runs at diagnostic/UI-refresh
 * time, never inside a per-frame solve loop.
 */
export function analyzeMobility(
  system: KinematicSystem,
  q: Float64Array = system.q0,
): MobilityReport {
  const { gruebler, linkCount, jointCount, groundLinkCount } = grueblerMobility(system);
  const { n, jointRows, m } = system;

  const jointJacobian = new Float64Array(jointRows * n);
  evalJacobian(system, q, jointJacobian, jointRows);
  const rankJoint = numericalRank(jointJacobian, jointRows, n);
  const rankDof = n - rankJoint;
  const redundantConstraints = jointRows - rankJoint;

  const fullJacobian = new Float64Array(m * n);
  evalJacobian(system, q, fullJacobian, m);
  const rankAll = numericalRank(fullJacobian, m, n);
  const drivenDof = n - rankAll;

  return {
    gruebler,
    linkCount,
    jointCount,
    groundLinkCount,
    rankDof,
    redundantConstraints,
    motorCount: system.motors.length,
    drivenDof,
  };
}
