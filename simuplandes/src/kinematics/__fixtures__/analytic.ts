/**
 * Closed-form four-bar helpers used only by the validation suite (KIN-04's
 * lock-up cross-check and branch-preservation tracking), never by the
 * solver itself (which must stay topology-general — Pattern 8's own
 * caveat).
 */

/**
 * The law-of-cosines crank-angle limits of a four-bar with ground `a1`,
 * input (crank) `a2`, coupler `a3`, output `a4`: the degenerate
 * (collinear coupler+output) triangle gives
 * `cos(theta2_limit) = (a1^2 + a2^2 - L^2) / (2*a1*a2)`, `L` in
 * `{a3+a4 (extended), |a3-a4| (folded)}`. Returns `[+limit, -limit]` for
 * each `L` whose cosine is in `[-1, 1]` (a full-rotation crank has none).
 * Empty when the crank can fully rotate relative to the ground link.
 */
export function fourBarLimitAngles(a1: number, a2: number, a3: number, a4: number): number[] {
  const limits: number[] = [];
  const candidates = [a3 + a4, Math.abs(a3 - a4)];
  for (const L of candidates) {
    const cosTheta = (a1 * a1 + a2 * a2 - L * L) / (2 * a1 * a2);
    if (cosTheta >= -1 && cosTheta <= 1) {
      const theta = Math.acos(cosTheta);
      limits.push(theta, -theta);
    }
  }
  return limits;
}

/**
 * The Freudenstein position equation for a four-bar (Norton form), solved
 * for `theta4` given `theta2` and a branch. Link lengths: `a` = input
 * (crank), `b` = coupler, `c` = output (rocker), `d` = ground.
 * `K1 = d/a`, `K2 = d/c`, `K3 = (a^2 - b^2 + c^2 + d^2) / (2*a*c)`, and
 * `K1*cos(theta4) - K2*cos(theta2) + K3 = cos(theta2 - theta4)`. Rearranged
 * (Weierstrass substitution `t = tan(theta4/2)`) into
 * `A*t^2 + B*t + C = 0` with `A = cos(theta2) - K1 - K2*cos(theta2) + K3`,
 * `B = -2*sin(theta2)`, `C = K1 - (K2+1)*cos(theta2) + K3`; `branch`
 * selects which root of the quadratic (i.e. which of the two assembly
 * branches) to return.
 */
export function freudensteinTheta4(
  a: number,
  b: number,
  c: number,
  d: number,
  theta2: number,
  branch: 1 | -1,
): number {
  const K1 = d / a;
  const K2 = d / c;
  const K3 = (a * a - b * b + c * c + d * d) / (2 * a * c);

  const cosT2 = Math.cos(theta2);
  const sinT2 = Math.sin(theta2);
  const A = cosT2 - K1 - K2 * cosT2 + K3;
  const B = -2 * sinT2;
  const C = K1 - (K2 + 1) * cosT2 + K3;

  const discriminant = Math.max(B * B - 4 * A * C, 0);
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const numerator = -B + branch * sqrtDiscriminant;
  return 2 * Math.atan2(numerator, 2 * A);
}

/** The absolute difference between two angles, reduced into `[0, pi]`. */
function angleDiff(x: number, y: number): number {
  let diff = (x - y) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff);
}

/**
 * Which `freudensteinTheta4` branch reproduces a given `theta4` at this
 * `theta2` (the branch whose predicted angle is closer to `theta4`) — used
 * to confirm continuation never silently jumps to the other assembly
 * branch.
 */
export function freudensteinBranchOf(
  a: number,
  b: number,
  c: number,
  d: number,
  theta2: number,
  theta4: number,
): 1 | -1 {
  const plus = freudensteinTheta4(a, b, c, d, theta2, 1);
  const minus = freudensteinTheta4(a, b, c, d, theta2, -1);
  return angleDiff(plus, theta4) <= angleDiff(minus, theta4) ? 1 : -1;
}

/**
 * Closed-form slider position for an offset slider-crank: crank `r` about
 * the origin, coupler `l`, the slider pin constrained to the line `y = e`.
 * `x(theta2) = r*cos(theta2) + sqrt(l^2 - (r*sin(theta2) - e)^2)` (the
 * "far" root -- the pin is always on the +x side of the crank pivot for
 * this fixture's geometry).
 */
export function sliderCrankPosition(r: number, l: number, e: number, theta2: number): number {
  const s = r * Math.sin(theta2) - e;
  return r * Math.cos(theta2) + Math.sqrt(l * l - s * s);
}

/**
 * `d/d(theta2) [sliderCrankPosition]`, scaled by `omega2` (the chain rule
 * for a time-varying `theta2(t) = theta2_0 + omega2*t`):
 * `dx/dtheta2 = -r*sin(theta2) - (r*sin(theta2)-e)*r*cos(theta2) / sqrt(l^2 - (r*sin(theta2)-e)^2)`.
 */
export function sliderCrankVelocity(
  r: number,
  l: number,
  e: number,
  theta2: number,
  omega2: number,
): number {
  const s = r * Math.sin(theta2) - e;
  const sqrtTerm = Math.sqrt(l * l - s * s);
  const dxDTheta2 = -r * Math.sin(theta2) - (s * r * Math.cos(theta2)) / sqrtTerm;
  return dxDTheta2 * omega2;
}
