/**
 * Dense linear algebra core for the kinematic engine: row-major
 * `Float64Array` matrices (`a[i*n + j]`), LU factorization with partial
 * pivoting, and a single damped normal-equations solve, `solveLeastSquares`,
 * used both by the per-frame Newton step and by assembly (03-03) — one
 * regularized-solve routine, not two (D2: there is ONE linear-solve core).
 *
 * All functions here are allocation-free given a `LinalgWorkspace` sized for
 * the system, with one exception: `numericalRank`'s internal copy, which
 * only runs at compile/diagnostic time, never in the per-frame hot path.
 */

/** Preallocated scratch buffers sized for an n-unknown system. Reused across calls; not re-entrant. */
export interface LinalgWorkspace {
  readonly n: number;
  readonly A: Float64Array; // n*n scratch for the (damped) normal matrix / JtJ
  readonly Acopy: Float64Array; // n*n scratch copy of JtJ, kept intact across an LU factorization of `A`
  readonly g: Float64Array; // n scratch for the RHS / Jt*rhs
  readonly piv: Int32Array; // n scratch for LU pivots
  readonly dx: Float64Array; // n scratch solution buffer
  readonly v: Float64Array; // n scratch iteration vector
  readonly w: Float64Array; // n scratch iteration vector
}

/** Allocates every scratch buffer `solveLeastSquares`/`estimateSingularValues` need for an n-unknown system. */
export function createLinalgWorkspace(n: number): LinalgWorkspace {
  return {
    n,
    A: new Float64Array(n * n),
    Acopy: new Float64Array(n * n),
    g: new Float64Array(n),
    piv: new Int32Array(n),
    dx: new Float64Array(n),
    v: new Float64Array(n),
    w: new Float64Array(n),
  };
}

/** Extremes of the |pivot| values seen during `luFactor`, and whether the matrix was (numerically) singular. */
export interface LuInfo {
  readonly singular: boolean;
  readonly minPivot: number;
  readonly maxPivot: number;
}

const ABSOLUTE_SINGULAR_THRESHOLD = 1e-300;
const RELATIVE_SINGULAR_THRESHOLD = 1e-15;

/**
 * Doolittle LU factorization with partial pivoting, in place. `piv[k]` is
 * the row swapped with row `k` at step `k` (LAPACK-style swap sequence, not
 * a final permutation array) — `luSolve` replays these swaps in order.
 *
 * A column is flagged `singular` when |pivot| <= 1e-300 or
 * |pivot| < 1e-15 * (max |pivot| seen so far). When that happens, the
 * elimination for that column is skipped (its multipliers are left at 0)
 * so `luSolve` stays finite instead of dividing by (near) zero.
 */
export function luFactor(a: Float64Array, n: number, piv: Int32Array): LuInfo {
  let minPivot = n > 0 ? Infinity : 0;
  let maxPivot = 0;
  let singular = false;

  for (let k = 0; k < n; k++) {
    let maxAbs = Math.abs(a[k * n + k]);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]);
      if (v > maxAbs) {
        maxAbs = v;
        maxRow = i;
      }
    }
    piv[k] = maxRow;
    if (maxRow !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = a[k * n + j];
        a[k * n + j] = a[maxRow * n + j];
        a[maxRow * n + j] = tmp;
      }
    }

    const pivotVal = a[k * n + k];
    const pivotAbs = Math.abs(pivotVal);
    if (pivotAbs > maxPivot) maxPivot = pivotAbs;
    if (pivotAbs < minPivot) minPivot = pivotAbs;

    const flaggedSingular =
      pivotAbs <= ABSOLUTE_SINGULAR_THRESHOLD || pivotAbs < RELATIVE_SINGULAR_THRESHOLD * maxPivot;
    if (flaggedSingular) {
      singular = true;
      for (let i = k + 1; i < n; i++) a[i * n + k] = 0;
      if (pivotAbs <= ABSOLUTE_SINGULAR_THRESHOLD) a[k * n + k] = 1; // avoid literal div-by-zero in luSolve
      continue;
    }

    const invPivot = 1 / pivotVal;
    for (let i = k + 1; i < n; i++) {
      const factor = a[i * n + k] * invPivot;
      a[i * n + k] = factor;
      for (let j = k + 1; j < n; j++) {
        a[i * n + j] -= factor * a[k * n + j];
      }
    }
  }

  return { singular, minPivot: n > 0 ? minPivot : 0, maxPivot };
}

/** Applies the permutation, then forward/back substitution, in place: `b` becomes `x`. */
export function luSolve(lu: Float64Array, n: number, piv: Int32Array, b: Float64Array): void {
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) {
      const tmp = b[k];
      b[k] = b[p];
      b[p] = tmp;
    }
  }

  // Forward substitution: L y = b (unit diagonal), overwriting b with y.
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let j = 0; j < i; j++) sum -= lu[i * n + j] * b[j];
    b[i] = sum;
  }

  // Back substitution: U x = y, overwriting b (y) with x.
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) sum -= lu[i * n + j] * b[j];
    b[i] = sum / lu[i * n + i];
  }
}

/**
 * Solves `(J^T J + lambda*I) x = J^T rhs`. `J` is `m x n` row-major. Writes
 * the solution into `out` and returns the LU info of the damped normal
 * matrix (its pivots double as the per-frame singularity signal).
 */
export function solveLeastSquares(
  J: Float64Array,
  m: number,
  n: number,
  rhs: Float64Array,
  lambda: number,
  out: Float64Array,
  ws: LinalgWorkspace,
): LuInfo {
  const A = ws.A;
  const g = ws.g;

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < m; k++) {
        sum += J[k * n + i] * J[k * n + j];
      }
      if (i === j) sum += lambda;
      A[i * n + j] = sum;
      A[j * n + i] = sum;
    }
    let gi = 0;
    for (let k = 0; k < m; k++) gi += J[k * n + i] * rhs[k];
    g[i] = gi;
  }

  const info = luFactor(A, n, ws.piv);
  for (let i = 0; i < n; i++) ws.dx[i] = g[i];
  luSolve(A, n, ws.piv, ws.dx);
  for (let i = 0; i < n; i++) out[i] = ws.dx[i];
  return info;
}

function normVec(v: Float64Array, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

// Always called on the fixed deterministic start vector (1 + index ramp),
// which is never the zero vector for n >= 1 (n === 0 is short-circuited by
// callers), so this never divides by zero.
function normalizeVecInPlace(v: Float64Array, n: number): void {
  const norm = normVec(v, n);
  for (let i = 0; i < n; i++) v[i] /= norm;
}

function matVec(a: Float64Array, n: number, x: Float64Array, out: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += a[i * n + j] * x[j];
    out[i] = sum;
  }
}

function dotVec(a: Float64Array, b: Float64Array, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

const POWER_ITERATIONS = 8;

/**
 * sigma_max by power iteration on J^T J, sigma_min by inverse iteration
 * (LU of J^T J, ~8 iterations from a fixed deterministic start vector — all
 * ones plus an index ramp, never `Math.random`). `min` is 0 if J^T J is
 * singular. For `n === 0`, returns `{min: 0, max: 0}`.
 */
export function estimateSingularValues(
  J: Float64Array,
  m: number,
  n: number,
  ws: LinalgWorkspace,
): { min: number; max: number } {
  if (n === 0) return { min: 0, max: 0 };

  const A = ws.A;
  const Acopy = ws.Acopy;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < m; k++) sum += J[k * n + i] * J[k * n + j];
      A[i * n + j] = sum;
      A[j * n + i] = sum;
      Acopy[i * n + j] = sum;
      Acopy[j * n + i] = sum;
    }
  }

  const v = ws.v;
  const w = ws.w;

  // Power iteration for the largest eigenvalue of J^T J (on Acopy, left intact).
  for (let i = 0; i < n; i++) v[i] = 1 + i * 1e-3;
  normalizeVecInPlace(v, n);
  for (let iter = 0; iter < POWER_ITERATIONS; iter++) {
    matVec(Acopy, n, v, w);
    const norm = normVec(w, n);
    if (norm === 0) break;
    for (let i = 0; i < n; i++) v[i] = w[i] / norm;
  }
  matVec(Acopy, n, v, w);
  const maxEigen = Math.max(dotVec(v, w, n), 0);
  const max = Math.sqrt(maxEigen);

  // Inverse iteration for the smallest eigenvalue of J^T J (destroys A via LU; Acopy stays intact).
  const info = luFactor(A, n, ws.piv);
  let min = 0;
  if (!info.singular) {
    for (let i = 0; i < n; i++) v[i] = 1 + i * 1e-3;
    normalizeVecInPlace(v, n);
    // A is non-singular here, so A^-1 * v (v always a unit vector) is never
    // exactly zero; no zero-norm guard is needed before normalizing.
    for (let iter = 0; iter < POWER_ITERATIONS; iter++) {
      for (let i = 0; i < n; i++) ws.dx[i] = v[i];
      luSolve(A, n, ws.piv, ws.dx);
      const norm = normVec(ws.dx, n);
      for (let i = 0; i < n; i++) v[i] = ws.dx[i] / norm;
    }
    matVec(Acopy, n, v, w);
    const minEigen = Math.max(dotVec(v, w, n), 0);
    min = Math.sqrt(minEigen);
  }

  return { min, max };
}

/**
 * Numerical rank of `J` (m x n) by Gaussian elimination with complete
 * (row+column) pivoting on a copy; pivots <= relTol * max|J| count as zero.
 * Runs at compile/diagnostic time only — the one place this module
 * allocates beyond its workspace.
 */
export function numericalRank(J: Float64Array, m: number, n: number, relTol = 1e-9): number {
  if (m === 0 || n === 0) return 0;

  const M = Float64Array.from(J);
  let maxAbs = 0;
  for (let i = 0; i < m * n; i++) {
    const a = Math.abs(M[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === 0) return 0;
  const threshold = relTol * maxAbs;

  const rowOrder = new Int32Array(m);
  const colOrder = new Int32Array(n);
  for (let i = 0; i < m; i++) rowOrder[i] = i;
  for (let j = 0; j < n; j++) colOrder[j] = j;

  let rank = 0;
  const limit = Math.min(m, n);
  for (let k = 0; k < limit; k++) {
    let best = 0;
    let bestI = -1;
    let bestJ = -1;
    for (let i = k; i < m; i++) {
      const ri = rowOrder[i];
      for (let j = k; j < n; j++) {
        const cj = colOrder[j];
        const value = Math.abs(M[ri * n + cj]);
        if (value > best) {
          best = value;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (best <= threshold) break;

    const tmpRow = rowOrder[k];
    rowOrder[k] = rowOrder[bestI];
    rowOrder[bestI] = tmpRow;
    const tmpCol = colOrder[k];
    colOrder[k] = colOrder[bestJ];
    colOrder[bestJ] = tmpCol;

    const pr = rowOrder[k];
    const pc = colOrder[k];
    const pivotVal = M[pr * n + pc];
    for (let i = k + 1; i < m; i++) {
      const ri = rowOrder[i];
      const factor = M[ri * n + pc] / pivotVal;
      if (factor === 0) continue;
      for (let j = k; j < n; j++) {
        const cj = colOrder[j];
        M[ri * n + cj] -= factor * M[pr * n + cj];
      }
    }
    rank++;
  }

  return rank;
}
