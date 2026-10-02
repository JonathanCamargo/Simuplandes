/**
 * The compiled constraint union and its residual/Jacobian evaluators for
 * every constraint kind: revolute (R), prismatic (P), rotary driver and
 * linear driver. Hot-path evaluation inlines cos/sin scalar math (no
 * per-call object allocation), equivalent to `src/geom`'s `rotate`/`perp`.
 *
 * Coordinates: `q` holds `[x, y, theta]` per moving link. A site's world
 * position is `p = r_k + R(theta_k)*s_local`; `d/dtheta [R(theta)*v]` is
 * `perp(R(theta)*v)` (see `src/geom`'s `perp`), which is the one
 * differentiation rule every Jacobian entry below reduces to.
 */

import { KinematicsError } from "./errors";
import type { KinematicSystem, SiteRef } from "./system";

/** A joint's compiled revolute constraint (2 rows: `pA - pB = 0`). */
export interface RevoluteConstraint {
  readonly kind: "revolute";
  readonly jointId: string;
  readonly label: string;
  readonly row: number;
  readonly a: SiteRef;
  readonly b: SiteRef;
}

/** A joint's compiled prismatic constraint (2 rows: relative-rotation lock + perpendicular-offset lock). */
export interface PrismaticConstraint {
  readonly kind: "prismatic";
  readonly jointId: string;
  readonly label: string;
  readonly row: number;
  readonly a: SiteRef;
  readonly b: SiteRef;
  readonly axisLocal: { readonly x: number; readonly y: number };
  readonly normalLocal: { readonly x: number; readonly y: number };
  readonly dThetaRef: number;
}

/** A rotary motor's driver row, locking the R joint's remaining relative-rotation DOF to an input value. */
export interface RotaryDriverConstraint {
  readonly kind: "rotary-driver";
  readonly motorId: string;
  readonly jointId: string;
  readonly label: string;
  readonly row: number;
  readonly motorIndex: number;
  readonly linkA: number;
  readonly linkB: number;
  readonly dThetaRef: number;
}

/** A linear motor's driver row, locking the P joint's remaining along-axis DOF to an input value. */
export interface LinearDriverConstraint {
  readonly kind: "linear-driver";
  readonly motorId: string;
  readonly jointId: string;
  readonly label: string;
  readonly row: number;
  readonly motorIndex: number;
  readonly a: SiteRef;
  readonly b: SiteRef;
  readonly axisLocal: { readonly x: number; readonly y: number };
  readonly refDist: number;
}

/** The compiled representation of any joint or motor constraint row. */
export type CompiledConstraint =
  RevoluteConstraint | PrismaticConstraint | RotaryDriverConstraint | LinearDriverConstraint;

function linkX(system: KinematicSystem, q: Float64Array, linkIndex: number): number {
  const slot = system.links[linkIndex];
  return slot.offset < 0 ? slot.reference.x : q[slot.offset];
}

function linkY(system: KinematicSystem, q: Float64Array, linkIndex: number): number {
  const slot = system.links[linkIndex];
  return slot.offset < 0 ? slot.reference.y : q[slot.offset + 1];
}

function linkTheta(system: KinematicSystem, q: Float64Array, linkIndex: number): number {
  const slot = system.links[linkIndex];
  return slot.offset < 0 ? slot.reference.angle : q[slot.offset + 2];
}

/** Rotates a link-local vector `(x, y)` by `(c, s) = (cos theta, sin theta)`. */
function rotX(x: number, y: number, c: number, s: number): number {
  return x * c - y * s;
}
function rotY(x: number, y: number, c: number, s: number): number {
  return x * s + y * c;
}

function assertQLength(system: KinematicSystem, q: Float64Array): void {
  if (q.length !== system.n) {
    throw new KinematicsError(
      "bad-input-length",
      `expected q.length === ${system.n}, got ${q.length}`,
    );
  }
}

function assertQDotLength(system: KinematicSystem, qDot: Float64Array): void {
  if (qDot.length !== system.n) {
    throw new KinematicsError(
      "bad-input-length",
      `expected qDot.length === ${system.n}, got ${qDot.length}`,
    );
  }
}

/** The angular velocity of link `linkIndex` (0 for ground links). */
function linkOmega(system: KinematicSystem, qDot: Float64Array, linkIndex: number): number {
  const slot = system.links[linkIndex];
  return slot.offset < 0 ? 0 : qDot[slot.offset + 2];
}

/** The x-translational velocity of link `linkIndex` (0 for ground links). */
function linkVx(system: KinematicSystem, qDot: Float64Array, linkIndex: number): number {
  const slot = system.links[linkIndex];
  return slot.offset < 0 ? 0 : qDot[slot.offset];
}

/** The y-translational velocity of link `linkIndex` (0 for ground links). */
function linkVy(system: KinematicSystem, qDot: Float64Array, linkIndex: number): number {
  const slot = system.links[linkIndex];
  return slot.offset < 0 ? 0 : qDot[slot.offset + 1];
}

/**
 * Fills `out[0..rows)` with the constraint residual `Phi(q, inputs)`.
 * `rows` defaults to `system.m`; pass `system.jointRows` to exclude driver
 * rows (motor inputs are then ignored).
 */
export function evalResidual(
  system: KinematicSystem,
  q: Float64Array,
  inputs: Float64Array,
  out: Float64Array,
  rows: number = system.m,
): void {
  assertQLength(system, q);

  for (const c of system.constraints) {
    if (c.row >= rows) continue;

    switch (c.kind) {
      case "revolute": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);
        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;

        out[c.row] = pAx - pBx;
        out[c.row + 1] = pAy - pBy;
        break;
      }

      case "prismatic": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const nix = rotX(c.normalLocal.x, c.normalLocal.y, ci, si);
        const niy = rotY(c.normalLocal.x, c.normalLocal.y, ci, si);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;
        const dx = pBx - pAx;
        const dy = pBy - pAy;

        out[c.row] = tj - ti - c.dThetaRef;
        out[c.row + 1] = nix * dx + niy * dy;
        break;
      }

      case "rotary-driver": {
        const ti = linkTheta(system, q, c.linkA);
        const tj = linkTheta(system, q, c.linkB);
        out[c.row] = tj - ti - c.dThetaRef - inputs[c.motorIndex];
        break;
      }

      case "linear-driver": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const aix = rotX(c.axisLocal.x, c.axisLocal.y, ci, si);
        const aiy = rotY(c.axisLocal.x, c.axisLocal.y, ci, si);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;
        const dx = pBx - pAx;
        const dy = pBy - pAy;

        out[c.row] = aix * dx + aiy * dy - c.refDist - inputs[c.motorIndex];
        break;
      }
    }
  }
}

/**
 * Fills `out` (row-major, `rows x system.n`, zero-filled inside) with the
 * analytic Jacobian `dPhi/dq`. `rows` defaults to `system.m`; pass
 * `system.jointRows` to exclude driver rows.
 */
export function evalJacobian(
  system: KinematicSystem,
  q: Float64Array,
  out: Float64Array,
  rows: number = system.m,
): void {
  assertQLength(system, q);
  const n = system.n;
  out.fill(0, 0, rows * n);

  for (const c of system.constraints) {
    if (c.row >= rows) continue;

    switch (c.kind) {
      case "revolute": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const slotI = system.links[li];
        const slotJ = system.links[lj];
        const r0 = c.row * n;
        const r1 = (c.row + 1) * n;

        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);
        if (slotI.offset >= 0) {
          const oi = slotI.offset;
          out[r0 + oi] += 1;
          out[r1 + oi + 1] += 1;
          out[r0 + oi + 2] += -offAy;
          out[r1 + oi + 2] += offAx;
        }

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);
        if (slotJ.offset >= 0) {
          const oj = slotJ.offset;
          out[r0 + oj] += -1;
          out[r1 + oj + 1] += -1;
          out[r0 + oj + 2] += offBy;
          out[r1 + oj + 2] += -offBx;
        }
        break;
      }

      case "prismatic": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const slotI = system.links[li];
        const slotJ = system.links[lj];

        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const nix = rotX(c.normalLocal.x, c.normalLocal.y, ci, si);
        const niy = rotY(c.normalLocal.x, c.normalLocal.y, ci, si);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;
        const dx = pBx - pAx;
        const dy = pBy - pAy;

        const rTheta = c.row * n;
        const rPerp = (c.row + 1) * n;

        if (slotI.offset >= 0) {
          const oi = slotI.offset;
          out[rTheta + oi + 2] += -1;
          out[rPerp + oi] += -nix;
          out[rPerp + oi + 1] += -niy;
          const perpNix = -niy;
          const perpNiy = nix;
          const perpOffAx = -offAy;
          const perpOffAy = offAx;
          out[rPerp + oi + 2] += perpNix * dx + perpNiy * dy - (nix * perpOffAx + niy * perpOffAy);
        }
        if (slotJ.offset >= 0) {
          const oj = slotJ.offset;
          out[rTheta + oj + 2] += 1;
          out[rPerp + oj] += nix;
          out[rPerp + oj + 1] += niy;
          const perpOffBx = -offBy;
          const perpOffBy = offBx;
          out[rPerp + oj + 2] += nix * perpOffBx + niy * perpOffBy;
        }
        break;
      }

      case "rotary-driver": {
        const slotI = system.links[c.linkA];
        const slotJ = system.links[c.linkB];
        const r0 = c.row * n;
        if (slotI.offset >= 0) out[r0 + slotI.offset + 2] += -1;
        if (slotJ.offset >= 0) out[r0 + slotJ.offset + 2] += 1;
        break;
      }

      case "linear-driver": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const slotI = system.links[li];
        const slotJ = system.links[lj];

        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const aix = rotX(c.axisLocal.x, c.axisLocal.y, ci, si);
        const aiy = rotY(c.axisLocal.x, c.axisLocal.y, ci, si);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;
        const dx = pBx - pAx;
        const dy = pBy - pAy;

        const r0 = c.row * n;
        if (slotI.offset >= 0) {
          const oi = slotI.offset;
          out[r0 + oi] += -aix;
          out[r0 + oi + 1] += -aiy;
          const perpAix = -aiy;
          const perpAiy = aix;
          const perpOffAx = -offAy;
          const perpOffAy = offAx;
          out[r0 + oi + 2] += perpAix * dx + perpAiy * dy - (aix * perpOffAx + aiy * perpOffAy);
        }
        if (slotJ.offset >= 0) {
          const oj = slotJ.offset;
          out[r0 + oj] += aix;
          out[r0 + oj + 1] += aiy;
          const perpOffBx = -offBy;
          const perpOffBy = offBx;
          out[r0 + oj + 2] += aix * perpOffBx + aiy * perpOffBy;
        }
        break;
      }
    }
  }
}

/**
 * Fills `out[0..rows)` with the acceleration right-hand side `gamma`, so
 * that `J(q) * qDDot = gamma` (with `J` from `evalJacobian`) is the full
 * acceleration-level constraint equation. `rows` defaults to `system.m`.
 *
 * Derivation (the one differentiation rule from the module doc comment,
 * applied twice): for a link-local vector `v` rotating with a link's angle
 * `theta`, `d/dt[R(theta)v] = omega * perp(R(theta)v)`, and
 * `d/dt[perp(R(theta)v)] = omega * perp(perp(R(theta)v)) = -omega^2 * R(theta)v`
 * (since `perp(perp(x)) = -x`). Differentiating each constraint's residual
 * twice and dropping every `qDDot`-linear term (those are exactly what
 * `evalJacobian` already captures) leaves `gamma`:
 *
 * - Revolute (`Phi = pA - pB`): `gamma = omega_i^2*offA - omega_j^2*offB`.
 * - Prismatic rotation row (`Phi = theta_j - theta_i - dThetaRef`, linear
 *   in `q`): `gamma = 0`.
 * - Prismatic perpendicular row (`Phi = n_i . d`, `d = pB - pA`,
 *   `dDot = rDot_j - rDot_i + omega_j*perp(offB) - omega_i*perp(offA)`):
 *   `gamma = omega_i^2*(n.d) - 2*omega_i*(perp(n).dDot) + omega_j^2*(n.offB)
 *            - omega_i^2*(n.offA)`.
 *   (The planner re-derived this from scratch and flipped the offA/offB
 *   term signs versus the phase research doc — the mandatory
 *   finite-difference cross-check in `gamma.test.ts` confirms this sign.)
 * - Rotary driver: `gamma = inputAccels[motorIndex]` (Phi is linear in q
 *   and in the driven angle, so the only q-independent second-derivative
 *   term is the driven angular acceleration itself).
 * - Linear driver (`Phi = aHat_i . d - refDist - s(t)`, structurally the
 *   same as the prismatic perpendicular row with `aHat_i` replacing `n_i`,
 *   plus the driven `s(t)` term): `gamma = omega_i^2*(aHat.d)
 *   - 2*omega_i*(perp(aHat).dDot) + omega_j^2*(aHat.offB)
 *   - omega_i^2*(aHat.offA) + inputAccels[motorIndex]`.
 */
export function evalGamma(
  system: KinematicSystem,
  q: Float64Array,
  qDot: Float64Array,
  inputAccels: Float64Array,
  out: Float64Array,
  rows: number = system.m,
): void {
  assertQLength(system, q);
  assertQDotLength(system, qDot);

  for (const c of system.constraints) {
    if (c.row >= rows) continue;

    switch (c.kind) {
      case "revolute": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;
        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const wi = linkOmega(system, qDot, li);
        const wj = linkOmega(system, qDot, lj);

        out[c.row] = wi * wi * offAx - wj * wj * offBx;
        out[c.row + 1] = wi * wi * offAy - wj * wj * offBy;
        break;
      }

      case "prismatic": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;

        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const nix = rotX(c.normalLocal.x, c.normalLocal.y, ci, si);
        const niy = rotY(c.normalLocal.x, c.normalLocal.y, ci, si);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;
        const dx = pBx - pAx;
        const dy = pBy - pAy;

        const wi = linkOmega(system, qDot, li);
        const wj = linkOmega(system, qDot, lj);
        const vix = linkVx(system, qDot, li);
        const viy = linkVy(system, qDot, li);
        const vjx = linkVx(system, qDot, lj);
        const vjy = linkVy(system, qDot, lj);

        const perpOffAx = -offAy;
        const perpOffAy = offAx;
        const perpOffBx = -offBy;
        const perpOffBy = offBx;
        const ddx = vjx - vix + wj * perpOffBx - wi * perpOffAx;
        const ddy = vjy - viy + wj * perpOffBy - wi * perpOffAy;

        const perpNix = -niy;
        const perpNiy = nix;
        const nDotD = nix * dx + niy * dy;
        const perpNDotDd = perpNix * ddx + perpNiy * ddy;
        const nDotOffB = nix * offBx + niy * offBy;
        const nDotOffA = nix * offAx + niy * offAy;

        out[c.row] = 0;
        out[c.row + 1] =
          wi * wi * nDotD - 2 * wi * perpNDotDd + wj * wj * nDotOffB - wi * wi * nDotOffA;
        break;
      }

      case "rotary-driver": {
        out[c.row] = inputAccels[c.motorIndex];
        break;
      }

      case "linear-driver": {
        const li = c.a.linkIndex;
        const lj = c.b.linkIndex;

        const ti = linkTheta(system, q, li);
        const ci = Math.cos(ti);
        const si = Math.sin(ti);
        const aix = rotX(c.axisLocal.x, c.axisLocal.y, ci, si);
        const aiy = rotY(c.axisLocal.x, c.axisLocal.y, ci, si);
        const offAx = rotX(c.a.local.x, c.a.local.y, ci, si);
        const offAy = rotY(c.a.local.x, c.a.local.y, ci, si);

        const tj = linkTheta(system, q, lj);
        const cj = Math.cos(tj);
        const sj = Math.sin(tj);
        const offBx = rotX(c.b.local.x, c.b.local.y, cj, sj);
        const offBy = rotY(c.b.local.x, c.b.local.y, cj, sj);

        const pAx = linkX(system, q, li) + offAx;
        const pAy = linkY(system, q, li) + offAy;
        const pBx = linkX(system, q, lj) + offBx;
        const pBy = linkY(system, q, lj) + offBy;
        const dx = pBx - pAx;
        const dy = pBy - pAy;

        const wi = linkOmega(system, qDot, li);
        const wj = linkOmega(system, qDot, lj);
        const vix = linkVx(system, qDot, li);
        const viy = linkVy(system, qDot, li);
        const vjx = linkVx(system, qDot, lj);
        const vjy = linkVy(system, qDot, lj);

        const perpOffAx = -offAy;
        const perpOffAy = offAx;
        const perpOffBx = -offBy;
        const perpOffBy = offBx;
        const ddx = vjx - vix + wj * perpOffBx - wi * perpOffAx;
        const ddy = vjy - viy + wj * perpOffBy - wi * perpOffAy;

        const perpAix = -aiy;
        const perpAiy = aix;
        const aDotD = aix * dx + aiy * dy;
        const perpADotDd = perpAix * ddx + perpAiy * ddy;
        const aDotOffB = aix * offBx + aiy * offBy;
        const aDotOffA = aix * offAx + aiy * offAy;

        out[c.row] =
          wi * wi * aDotD -
          2 * wi * perpADotDd +
          wj * wj * aDotOffB -
          wi * wi * aDotOffA +
          inputAccels[c.motorIndex];
        break;
      }
    }
  }
}
