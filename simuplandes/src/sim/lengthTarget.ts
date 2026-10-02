/**
 * Length-target fit for lengths-only graphs (09-02). Unknowns are the 2E
 * joint coordinates (joints are shared points, so loop closure is automatic);
 * the constraints are GraphThe's per-link lengths (the maximum pairwise
 * joint distance on a link). A binary link constrains its one distance
 * exactly; for a link with 3+ joints the farthest seed pair is pinned to L
 * and every other pair is one-sided (`d <= L`). A `null` length imposes
 * nothing. Levenberg-Marquardt on the damped normal equations
 * (`kinematics/linalg.solveLeastSquares`); the damping also fixes the
 * rigid-motion gauge.
 */

import type { LayoutRequest, Vec2Tuple } from "../interchange/importReport";
import { createLinalgWorkspace, solveLeastSquares } from "../kinematics";

export interface LengthFit {
  readonly positions: Vec2Tuple[];
  /** Euclidean norm of the final residual vector. */
  readonly residual: number;
  readonly feasible: boolean;
}

const MAX_ITERATIONS = 100;
const INITIAL_LAMBDA = 1e-3;
const FEASIBLE_RELATIVE = 1e-6;
const CONVERGED_RELATIVE = 1e-9;

interface Term {
  /** Edge indices whose joint points are compared. */
  readonly a: number;
  readonly b: number;
  readonly length: number;
  readonly oneSided: boolean;
}

function dist(x: Float64Array, a: number, b: number): number {
  return Math.hypot(x[2 * a] - x[2 * b], x[2 * a + 1] - x[2 * b + 1]);
}

function buildTerms(req: LayoutRequest, x: Float64Array): Term[] {
  const terms: Term[] = [];
  const lengths = req.lengths ?? [];
  for (let node = 0; node < req.nodeCount; node++) {
    const length = lengths[node];
    if (length === null || length === undefined) continue;
    const joints: number[] = [];
    req.edges.forEach((e, i) => {
      if (e.u === node || e.v === node) joints.push(i);
    });
    if (joints.length < 2) continue;
    let far: [number, number] = [joints[0], joints[1]];
    let farDistance = -1;
    for (let i = 0; i < joints.length; i++) {
      for (let j = i + 1; j < joints.length; j++) {
        const d = dist(x, joints[i], joints[j]);
        if (d > farDistance) {
          farDistance = d;
          far = [joints[i], joints[j]];
        }
      }
    }
    for (let i = 0; i < joints.length; i++) {
      for (let j = i + 1; j < joints.length; j++) {
        const pinned = joints[i] === far[0] && joints[j] === far[1];
        terms.push({ a: joints[i], b: joints[j], length, oneSided: !pinned });
      }
    }
  }
  return terms;
}

function residuals(terms: readonly Term[], x: Float64Array, out: Float64Array): number {
  let sum = 0;
  terms.forEach((t, k) => {
    const d = dist(x, t.a, t.b);
    const r = t.oneSided ? Math.max(0, d - t.length) : d - t.length;
    out[k] = r;
    sum += r * r;
  });
  return sum;
}

function jacobian(terms: readonly Term[], x: Float64Array, n: number, J: Float64Array): void {
  J.fill(0);
  terms.forEach((t, k) => {
    const d = dist(x, t.a, t.b);
    if (d < 1e-12 || (t.oneSided && d <= t.length)) return;
    const ux = (x[2 * t.a] - x[2 * t.b]) / d;
    const uy = (x[2 * t.a + 1] - x[2 * t.b + 1]) / d;
    J[k * n + 2 * t.a] += ux;
    J[k * n + 2 * t.a + 1] += uy;
    J[k * n + 2 * t.b] -= ux;
    J[k * n + 2 * t.b + 1] -= uy;
  });
}

/** Fits `seed` (one point per edge) to the request's link lengths. */
export function fitLengths(req: LayoutRequest, seed: readonly Vec2Tuple[]): LengthFit {
  const n = 2 * req.edges.length;
  const x = new Float64Array(n);
  seed.forEach((p, i) => {
    x[2 * i] = p[0];
    x[2 * i + 1] = p[1];
  });
  const toPositions = (): Vec2Tuple[] => req.edges.map((_, i) => [x[2 * i], x[2 * i + 1]] as const);

  const terms = buildTerms(req, x);
  if (terms.length === 0) return { positions: toPositions(), residual: 0, feasible: true };
  const maxLength = Math.max(...terms.map((t) => t.length), 1e-12);

  const m = terms.length;
  const r = new Float64Array(m);
  const trial = new Float64Array(m);
  const rhs = new Float64Array(m);
  const J = new Float64Array(m * n);
  const dx = new Float64Array(n);
  const xNew = new Float64Array(n);
  const ws = createLinalgWorkspace(n);

  let cost = residuals(terms, x, r);
  let lambda = INITIAL_LAMBDA;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (Math.sqrt(cost) <= CONVERGED_RELATIVE * maxLength) break;
    jacobian(terms, x, n, J);
    for (let k = 0; k < m; k++) rhs[k] = -r[k];
    let accepted = false;
    for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
      solveLeastSquares(J, m, n, rhs, lambda * maxLength * maxLength, dx, ws);
      for (let i = 0; i < n; i++) xNew[i] = x[i] + dx[i];
      const newCost = residuals(terms, xNew, trial);
      if (Number.isFinite(newCost) && newCost < cost) {
        x.set(xNew);
        r.set(trial);
        cost = newCost;
        lambda = Math.max(lambda * 0.1, 1e-12);
        accepted = true;
      } else {
        lambda *= 10;
      }
    }
    if (!accepted) break;
  }

  const residual = Math.sqrt(cost);
  return {
    positions: toPositions(),
    residual,
    feasible: residual <= FEASIBLE_RELATIVE * maxLength,
  };
}
