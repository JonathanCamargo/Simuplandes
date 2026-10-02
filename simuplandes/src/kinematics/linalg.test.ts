import { describe, it, expect } from "vitest";
import {
  luFactor,
  luSolve,
  solveLeastSquares,
  estimateSingularValues,
  numericalRank,
  createLinalgWorkspace,
} from "./linalg";

/** Deterministic LCG so tests never depend on Math.random. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randomMatrix(n: number, rng: () => number): Float64Array {
  const a = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = rng() * 2 - 1;
  // Strengthen the diagonal so the matrix is well-conditioned.
  for (let i = 0; i < n; i++) a[i * n + i] += n;
  return a;
}

function matVecMul(a: Float64Array, n: number, x: Float64Array): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += a[i * n + j] * x[j];
    out[i] = sum;
  }
  return out;
}

describe("luFactor + luSolve", () => {
  it("solves a random well-conditioned 6x6 system to 1e-12 relative", () => {
    const rng = makeLcg(42);
    const n = 6;
    const a = randomMatrix(n, rng);
    const aOrig = Float64Array.from(a);
    const x = Float64Array.from({ length: n }, () => rng() * 10 - 5);
    const b = matVecMul(aOrig, n, x);

    const piv = new Int32Array(n);
    const info = luFactor(a, n, piv);
    expect(info.singular).toBe(false);
    luSolve(a, n, piv, b);

    for (let i = 0; i < n; i++) {
      const rel = Math.abs(b[i] - x[i]) / Math.max(1, Math.abs(x[i]));
      expect(rel).toBeLessThan(1e-12);
    }
  });

  it("solves a random well-conditioned 27x27 system to 1e-12 relative", () => {
    const rng = makeLcg(1337);
    const n = 27;
    const a = randomMatrix(n, rng);
    const aOrig = Float64Array.from(a);
    const x = Float64Array.from({ length: n }, () => rng() * 10 - 5);
    const b = matVecMul(aOrig, n, x);

    const piv = new Int32Array(n);
    const info = luFactor(a, n, piv);
    expect(info.singular).toBe(false);
    luSolve(a, n, piv, b);

    for (let i = 0; i < n; i++) {
      const rel = Math.abs(b[i] - x[i]) / Math.max(1, Math.abs(x[i]));
      expect(rel).toBeLessThan(1e-12);
    }
  });

  it("handles matrices that need row swaps (zero on the diagonal)", () => {
    // n=3, a[0][0] = 0 forces a pivot swap.
    // x + y + z = 6; 2x - y + z = 2; -y + 2z = 3  (chosen so [0,0] starts at 0)
    const n = 3;
    // Build so a[0*3+0] === 0:
    // row0: 0x + 1y + 1z = b0
    // row1: 1x + 1y + 1z = b1
    // row2: 2x - 1y + 3z = b2
    const a = new Float64Array([0, 1, 1, 1, 1, 1, 2, -1, 3]);
    const x = new Float64Array([1, 2, 3]);
    const aOrig = Float64Array.from(a);
    const b = matVecMul(aOrig, n, x);
    const piv = new Int32Array(n);
    const info = luFactor(a, n, piv);
    expect(info.singular).toBe(false);
    luSolve(a, n, piv, b);
    for (let i = 0; i < n; i++) {
      expect(b[i]).toBeCloseTo(x[i], 9);
    }
  });

  it("returns singular:true on an exactly singular matrix and does not throw", () => {
    const n = 3;
    // row3 = row1 + row2 -> singular
    const a = new Float64Array([1, 2, 3, 4, 5, 6, 5, 7, 9]);
    const piv = new Int32Array(n);
    let info: ReturnType<typeof luFactor> | undefined;
    expect(() => {
      info = luFactor(a, n, piv);
    }).not.toThrow();
    expect(info?.singular).toBe(true);
  });
});

describe("solveLeastSquares", () => {
  it("with lambda=0 on a square non-singular J matches direct LU (1e-10)", () => {
    const n = 4;
    const rng = makeLcg(7);
    const J = randomMatrix(n, rng);
    const jForLu = Float64Array.from(J);
    const x = Float64Array.from({ length: n }, () => rng() * 4 - 2);
    const rhs = matVecMul(J, n, x);

    const ws = createLinalgWorkspace(n);
    const out = new Float64Array(n);
    solveLeastSquares(J, n, n, rhs, 0, out, ws);

    // Cross-check with direct LU on the same system.
    const piv = new Int32Array(n);
    luFactor(jForLu, n, piv);
    const direct = Float64Array.from(rhs);
    luSolve(jForLu, n, piv, direct);

    for (let i = 0; i < n; i++) {
      expect(out[i]).toBeCloseTo(direct[i], 8);
    }
  });

  it("recovers the exact solution on an over-determined consistent 5x3 system", () => {
    const m = 5;
    const n = 3;
    const rng = makeLcg(99);
    const J = new Float64Array(m * n);
    for (let i = 0; i < m * n; i++) J[i] = rng() * 2 - 1;
    const x = new Float64Array([1, -2, 3]);
    const rhs = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += J[i * n + j] * x[j];
      rhs[i] = sum;
    }

    const ws = createLinalgWorkspace(n);
    const out = new Float64Array(n);
    solveLeastSquares(J, m, n, rhs, 0, out, ws);
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBeCloseTo(x[i], 8);
    }
  });

  it("returns a finite x with lambda>0 on a rank-deficient J", () => {
    const m = 4;
    const n = 3;
    // Column 2 = 2 * column 0 -> rank-deficient.
    const J = new Float64Array([1, 0, 2, 0, 1, 0, 1, 1, 2, 2, 0, 4]);
    const rhs = new Float64Array([1, 2, 3, 4]);
    const ws = createLinalgWorkspace(n);
    const out = new Float64Array(n);
    solveLeastSquares(J, m, n, rhs, 1e-6, out, ws);
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

describe("estimateSingularValues", () => {
  it("diag(3,2,1e-4) padded as a 4x3 J gives min ~ 1e-4 and max ~ 3", () => {
    const m = 4;
    const n = 3;
    const J = new Float64Array([3, 0, 0, 0, 2, 0, 0, 0, 1e-4, 0, 0, 0]);
    const ws = createLinalgWorkspace(n);
    const { min, max } = estimateSingularValues(J, m, n, ws);
    expect(Math.abs(min - 1e-4) / 1e-4).toBeLessThan(1e-6);
    expect(Math.abs(max - 3) / 3).toBeLessThan(1e-6);
  });

  it("on a singular J, min is 0 or < 1e-12*max", () => {
    const m = 3;
    const n = 3;
    // Column 2 = column 0 + column 1 -> singular.
    const J = new Float64Array([1, 0, 1, 0, 1, 1, 0, 0, 0]);
    const ws = createLinalgWorkspace(n);
    const { min, max } = estimateSingularValues(J, m, n, ws);
    expect(min === 0 || min < 1e-12 * max).toBe(true);
  });

  it("returns {min: 0, max: 0} for n === 0", () => {
    const ws = createLinalgWorkspace(0);
    expect(estimateSingularValues(new Float64Array(0), 0, 0, ws)).toEqual({ min: 0, max: 0 });
  });

  it("an all-zero J gives {min: 0, max: 0} (power iteration's zero-norm break)", () => {
    const m = 3;
    const n = 3;
    const J = new Float64Array(m * n);
    const ws = createLinalgWorkspace(n);
    expect(estimateSingularValues(J, m, n, ws)).toEqual({ min: 0, max: 0 });
  });
});

describe("numericalRank", () => {
  it("identity -> n", () => {
    const n = 4;
    const J = new Float64Array(n * n);
    for (let i = 0; i < n; i++) J[i * n + i] = 1;
    expect(numericalRank(J, n, n)).toBe(n);
  });

  it("a 3x3 matrix with row3 = row1 + row2 -> 2", () => {
    const J = new Float64Array([1, 2, 3, 4, 5, 6, 5, 7, 9]);
    expect(numericalRank(J, 3, 3)).toBe(2);
  });

  it("a zero matrix -> 0", () => {
    const J = new Float64Array(9);
    expect(numericalRank(J, 3, 3)).toBe(0);
  });

  it("a 4x3 full-column-rank matrix -> 3", () => {
    const J = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
    expect(numericalRank(J, 4, 3)).toBe(3);
  });

  it("m === 0 -> 0", () => {
    expect(numericalRank(new Float64Array(0), 0, 3)).toBe(0);
  });

  it("n === 0 -> 0", () => {
    expect(numericalRank(new Float64Array(0), 3, 0)).toBe(0);
  });
});
