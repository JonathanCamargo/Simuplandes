/**
 * The terms of the equations of motion `M(q) a + J^T lambda = Q(t, q, v)`,
 * in SI coordinates (see `system.ts`). All inputs `q`, `v` are in model
 * coordinates; every output is SI.
 *
 * The coordinates of a body are its frame origin `r` and angle `theta`, not
 * its center of mass, so with `s = R(theta) com` (meters):
 *
 *   M_body = [ m      0      -m s_y         ]
 *            [ 0      m       m s_x         ]
 *            [ -m s_y m s_x   I + m |s|^2   ]
 *
 * and the velocity-dependent term moves to the right-hand side as
 * `Q_v = m omega^2 [s_x, s_y, 0]` (from `d/dt perp(s) = -omega s`).
 */

import { evalCoordinate } from "./coordinates";
import type { DynamicSystem } from "./system";

/** World offset of a link-local point (meters) and the link's DOF offset (-1 for ground). */
interface PointFrame {
  offset: number;
  angle: number;
  /** Frame origin, meters. */
  rx: number;
  ry: number;
  /** World offset of the point from the frame origin, meters. */
  px: number;
  py: number;
}

function pointFrame(
  dyn: DynamicSystem,
  q: Float64Array,
  linkIndex: number,
  local: { readonly x: number; readonly y: number },
  out: PointFrame,
): PointFrame {
  const slot = dyn.kin.links[linkIndex];
  const L = dyn.metersPerUnit;
  let x: number;
  let y: number;
  let angle: number;
  if (slot.offset < 0) {
    x = slot.reference.x;
    y = slot.reference.y;
    angle = slot.reference.angle;
  } else {
    x = q[slot.offset];
    y = q[slot.offset + 1];
    angle = q[slot.offset + 2];
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.offset = slot.offset;
  out.angle = angle;
  out.rx = x * L;
  out.ry = y * L;
  out.px = (local.x * c - local.y * s) * L;
  out.py = (local.x * s + local.y * c) * L;
  return out;
}

function newFrame(): PointFrame {
  return { offset: -1, angle: 0, rx: 0, ry: 0, px: 0, py: 0 };
}

/** Converts model-coordinate rates to SI (`out[i] = v[i] * colScale[i]`). */
export function toSIRates(dyn: DynamicSystem, v: Float64Array, out: Float64Array): void {
  for (let i = 0; i < v.length; i++) out[i] = v[i] * dyn.colScale[i];
}

/** World velocity (m/s) of a point given its frame, from SI rates. */
function pointVelocity(frame: PointFrame, vSI: Float64Array): { x: number; y: number } {
  if (frame.offset < 0) return { x: 0, y: 0 };
  const o = frame.offset;
  const w = vSI[o + 2];
  return { x: vSI[o] - w * frame.py, y: vSI[o + 1] + w * frame.px };
}

/** Adds a world force `(fx, fy)` (N) at a point to the generalized force `Q`. */
function addPointForce(Q: Float64Array, frame: PointFrame, fx: number, fy: number): void {
  if (frame.offset < 0) return;
  const o = frame.offset;
  Q[o] += fx;
  Q[o + 1] += fy;
  Q[o + 2] += -frame.py * fx + frame.px * fy;
}

/** Fills `M` (n x n, row-major) with the SI mass matrix at `q`. */
export function assembleMass(dyn: DynamicSystem, q: Float64Array, M: Float64Array): void {
  const n = dyn.kin.n;
  const L = dyn.metersPerUnit;
  M.fill(0, 0, n * n);
  for (const body of dyn.bodies) {
    const o = body.offset;
    const angle = q[o + 2];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const sx = (body.com.x * c - body.com.y * s) * L;
    const sy = (body.com.x * s + body.com.y * c) * L;
    const mass = body.mass;
    M[o * n + o] += mass;
    M[(o + 1) * n + o + 1] += mass;
    M[o * n + o + 2] += -mass * sy;
    M[(o + 2) * n + o] += -mass * sy;
    M[(o + 1) * n + o + 2] += mass * sx;
    M[(o + 2) * n + o + 1] += mass * sx;
    M[(o + 2) * n + o + 2] += body.inertia + mass * (sx * sx + sy * sy);
  }
}

/** The SI gradient of a joint coordinate (into `out`), and the coordinate's value and rate in model units. */
function coordinateSI(
  dyn: DynamicSystem,
  q: Float64Array,
  v: Float64Array,
  coord: Parameters<typeof evalCoordinate>[2],
  out: Float64Array,
): { value: number; rate: number } {
  const value = evalCoordinate(dyn.kin, q, coord, out);
  let rate = 0;
  for (let i = 0; i < out.length; i++) rate += out[i] * v[i];
  const rowScale = coord.kind === "slide" ? dyn.metersPerUnit : 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] * rowScale) / dyn.colScale[i];
  return { value, rate };
}

/** The outcome of `assembleForces`: the id of the first effort motor whose effort was not finite, if any. */
export interface ForceResult {
  readonly invalidMotorId: string | null;
}

/**
 * Fills `Q` (length n) with the SI generalized forces at `(t, q, v)`:
 * velocity terms, gravity, loads, springs and dampers, and effort motors.
 * A motor whose expression failed to compile, or whose effort is not
 * finite, is reported in the result and contributes nothing.
 */
export function assembleForces(
  dyn: DynamicSystem,
  t: number,
  q: Float64Array,
  v: Float64Array,
  Q: Float64Array,
): ForceResult {
  const ws = dyn.workspace;
  const vSI = ws.vSI;
  const grad = ws.grad;
  const L = dyn.metersPerUnit;
  Q.fill(0);
  toSIRates(dyn, v, vSI);

  const g = dyn.gravity;
  for (const body of dyn.bodies) {
    const o = body.offset;
    const angle = q[o + 2];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const sx = (body.com.x * c - body.com.y * s) * L;
    const sy = (body.com.x * s + body.com.y * c) * L;
    const w = vSI[o + 2];
    const mass = body.mass;
    Q[o] += mass * w * w * sx + mass * g.x;
    Q[o + 1] += mass * w * w * sy + mass * g.y;
    Q[o + 2] += -sy * mass * g.x + sx * mass * g.y;
  }

  const frame = newFrame();
  for (const load of dyn.loads) {
    pointFrame(dyn, q, load.linkIndex, load.local, frame);
    addPointForce(Q, frame, load.fx, load.fy);
    Q[frame.offset + 2] += load.torque;
  }

  const frameB = newFrame();
  for (const spring of dyn.linearSprings) {
    pointFrame(dyn, q, spring.a.linkIndex, spring.a.local, frame);
    pointFrame(dyn, q, spring.b.linkIndex, spring.b.local, frameB);
    const dx = frameB.rx + frameB.px - (frame.rx + frame.px);
    const dy = frameB.ry + frameB.py - (frame.ry + frame.py);
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) continue;
    const ux = dx / length;
    const uy = dy / length;
    const va = pointVelocity(frame, vSI);
    const vb = pointVelocity(frameB, vSI);
    const lengthRate = ux * (vb.x - va.x) + uy * (vb.y - va.y);
    const tension = spring.stiffness * (length - spring.freeLength) + spring.damping * lengthRate;
    addPointForce(Q, frame, tension * ux, tension * uy);
    addPointForce(Q, frameB, -tension * ux, -tension * uy);
  }

  for (const spring of dyn.torsionalSprings) {
    const { value, rate } = coordinateSI(dyn, q, v, spring.coord, grad);
    const torque = -spring.stiffness * (value - spring.freeAngle) - spring.damping * rate;
    for (let i = 0; i < Q.length; i++) Q[i] += torque * grad[i];
  }

  let invalidMotorId: string | null = null;
  for (const actuator of dyn.actuators) {
    if (!actuator.evaluate) {
      invalidMotorId ??= actuator.motorId;
      continue;
    }
    const { value, rate } = coordinateSI(dyn, q, v, actuator.coord, grad);
    const effort = actuator.evaluate(t, value, rate);
    if (!Number.isFinite(effort)) {
      invalidMotorId ??= actuator.motorId;
      continue;
    }
    for (let i = 0; i < Q.length; i++) Q[i] += effort * grad[i];
  }

  return { invalidMotorId };
}

/** The effort each effort motor applies at `(t, q, v)`, indexed like `dyn.actuators` (NaN when invalid). */
export function actuatorEfforts(
  dyn: DynamicSystem,
  t: number,
  q: Float64Array,
  v: Float64Array,
): Float64Array {
  const out = new Float64Array(dyn.actuators.length);
  dyn.actuators.forEach((actuator, i) => {
    if (!actuator.evaluate) {
      out[i] = NaN;
      return;
    }
    const value = evalCoordinate(dyn.kin, q, actuator.coord, dyn.workspace.grad);
    let rate = 0;
    for (let k = 0; k < v.length; k++) rate += dyn.workspace.grad[k] * v[k];
    out[i] = actuator.evaluate(t, value, rate);
  });
  return out;
}

/** Kinetic and potential energy (J). Potential covers gravity, springs and the constant loads. */
export interface Energy {
  readonly kinetic: number;
  readonly potential: number;
}

/** The mechanical energy at `(q, v)`. Dampers and effort motors are not conservative and have no potential. */
export function energy(dyn: DynamicSystem, q: Float64Array, v: Float64Array): Energy {
  const L = dyn.metersPerUnit;
  const vSI = dyn.workspace.vSI;
  toSIRates(dyn, v, vSI);

  let kinetic = 0;
  let potential = 0;
  const g = dyn.gravity;
  for (const body of dyn.bodies) {
    const o = body.offset;
    const angle = q[o + 2];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const sx = (body.com.x * c - body.com.y * s) * L;
    const sy = (body.com.x * s + body.com.y * c) * L;
    const w = vSI[o + 2];
    const vcx = vSI[o] - w * sy;
    const vcy = vSI[o + 1] + w * sx;
    kinetic += 0.5 * body.mass * (vcx * vcx + vcy * vcy) + 0.5 * body.inertia * w * w;
    const cx = q[o] * L + sx;
    const cy = q[o + 1] * L + sy;
    potential -= body.mass * (g.x * cx + g.y * cy);
  }

  const frame = newFrame();
  for (const load of dyn.loads) {
    pointFrame(dyn, q, load.linkIndex, load.local, frame);
    potential -= load.fx * (frame.rx + frame.px) + load.fy * (frame.ry + frame.py);
    potential -= load.torque * frame.angle;
  }

  const frameB = newFrame();
  for (const spring of dyn.linearSprings) {
    pointFrame(dyn, q, spring.a.linkIndex, spring.a.local, frame);
    pointFrame(dyn, q, spring.b.linkIndex, spring.b.local, frameB);
    const length = Math.hypot(
      frameB.rx + frameB.px - (frame.rx + frame.px),
      frameB.ry + frameB.py - (frame.ry + frame.py),
    );
    const stretch = length - spring.freeLength;
    potential += 0.5 * spring.stiffness * stretch * stretch;
  }

  for (const spring of dyn.torsionalSprings) {
    const value = evalCoordinate(dyn.kin, q, spring.coord, null);
    const twist = value - spring.freeAngle;
    potential += 0.5 * spring.stiffness * twist * twist;
  }

  return { kinetic, potential };
}

/** The current length (model units) and tension (N, positive when stretched) of every linear spring. */
export function springStates(
  dyn: DynamicSystem,
  q: Float64Array,
  v: Float64Array,
): { length: number; force: number }[] {
  const vSI = dyn.workspace.vSI;
  toSIRates(dyn, v, vSI);
  const frame = newFrame();
  const frameB = newFrame();
  return dyn.linearSprings.map((spring) => {
    pointFrame(dyn, q, spring.a.linkIndex, spring.a.local, frame);
    pointFrame(dyn, q, spring.b.linkIndex, spring.b.local, frameB);
    const dx = frameB.rx + frameB.px - (frame.rx + frame.px);
    const dy = frameB.ry + frameB.py - (frame.ry + frame.py);
    const length = Math.hypot(dx, dy);
    let lengthRate = 0;
    if (length >= 1e-12) {
      const va = pointVelocity(frame, vSI);
      const vb = pointVelocity(frameB, vSI);
      lengthRate = (dx * (vb.x - va.x) + dy * (vb.y - va.y)) / length;
    }
    const force = spring.stiffness * (length - spring.freeLength) + spring.damping * lengthRate;
    return { length: length / dyn.metersPerUnit, force };
  });
}
