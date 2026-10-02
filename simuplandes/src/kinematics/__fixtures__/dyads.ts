/**
 * An independent reference construction for the six-bar / 10-bar
 * validation suite: NO use of `src/kinematics`' own solver code (not
 * `compileSystem`, not `evalResidual`/`evalJacobian`, not `newtonSolve`).
 * Only `circleIntersection` (this directory's own helper), plain `src/geom`
 * trig, and a "rigid point of an already-positioned link" step are used --
 * a hand-rolled RRR-dyad chain, exactly the classical constructive method
 * for building (not solving) a 1-DOF planar linkage from its input angle.
 */

import { add, sub, rotate, direction, distance, fromPolar, type Vec2 } from "../../geom";
import { circleIntersection } from "./build";

/** The single driven crank: a pivot (by name, resolved via `ground` or an earlier step) and length. */
export interface DyadCrank {
  readonly pivotName: string;
  readonly pointName: string;
  readonly length: number;
  readonly referenceAngle: number;
}

/**
 * One step of the chain: either a rigid point of an already-positioned
 * link (`base1`/`base2` are two of that link's already-known points;
 * `local` is expressed in the frame whose origin is `base1` and whose
 * +x axis points toward `base2`, exactly `poseFromWorldPoints`'s
 * convention), or the intersection of two circles centered at two
 * already-known points.
 */
export type DyadStep =
  | {
      readonly kind: "rigid";
      readonly name: string;
      readonly base1: string;
      readonly base2: string;
      readonly local: Vec2;
    }
  | {
      readonly kind: "intersection";
      readonly name: string;
      readonly center1: string;
      readonly radius1: number;
      readonly center2: string;
      readonly radius2: number;
    };

/**
 * A full dyad-chain specification: named ground pivots (fixed for every
 * `theta2`), the driven crank, an ordered list of steps, and the AUTHORED
 * reference-pose world position of every step's output point -- used only
 * once, by `captureSigns`, to fix which root of each intersection's
 * quadratic is the real one.
 */
export interface DyadChainSpec {
  readonly ground: Readonly<Record<string, Vec2>>;
  readonly crank: DyadCrank;
  readonly steps: readonly DyadStep[];
  readonly referencePoints: Readonly<Record<string, Vec2>>;
}

function resolvePoint(
  points: ReadonlyMap<string, Vec2>,
  ground: Readonly<Record<string, Vec2>>,
  name: string,
): Vec2 {
  const fromPoints = points.get(name);
  if (fromPoints) return fromPoints;
  const fromGround = ground[name];
  if (fromGround) return fromGround;
  throw new Error(`solveDyadChain: unknown point "${name}"`);
}

interface ChainRun {
  readonly points: Map<string, Vec2>;
  readonly capturedSigns: Map<string, 1 | -1>;
}

/**
 * Runs the chain once at `theta2`. When `signs` is `null` (capture mode,
 * only ever used by `captureSigns` at the reference angle), each
 * intersection step tries both roots and keeps whichever lands closer to
 * `spec.referencePoints[step.name]`, recording that choice. Otherwise,
 * every intersection uses its already-captured, fixed sign.
 */
function runChain(
  spec: DyadChainSpec,
  theta2: number,
  signs: ReadonlyMap<string, 1 | -1> | null,
): ChainRun {
  const points = new Map<string, Vec2>();
  for (const [name, p] of Object.entries(spec.ground)) points.set(name, p);

  const pivot = resolvePoint(points, spec.ground, spec.crank.pivotName);
  const crankPoint = add(pivot, fromPolar(spec.crank.length, theta2));
  points.set(spec.crank.pointName, crankPoint);

  const capturedSigns = new Map<string, 1 | -1>();

  for (const step of spec.steps) {
    if (step.kind === "rigid") {
      const base1 = resolvePoint(points, spec.ground, step.base1);
      const base2 = resolvePoint(points, spec.ground, step.base2);
      const angle = direction(sub(base2, base1));
      points.set(step.name, add(base1, rotate(step.local, angle)));
      continue;
    }

    const center1 = resolvePoint(points, spec.ground, step.center1);
    const center2 = resolvePoint(points, spec.ground, step.center2);

    let sign: 1 | -1;
    if (signs) {
      const captured = signs.get(step.name);
      if (captured === undefined) {
        throw new Error(`solveDyadChain: missing captured sign for "${step.name}"`);
      }
      sign = captured;
    } else {
      const plus = circleIntersection(center1, step.radius1, center2, step.radius2, 1);
      const minus = circleIntersection(center1, step.radius1, center2, step.radius2, -1);
      const reference = spec.referencePoints[step.name];
      if (!reference) {
        throw new Error(`captureSigns: missing referencePoints["${step.name}"]`);
      }
      sign = distance(plus, reference) <= distance(minus, reference) ? 1 : -1;
    }

    points.set(step.name, circleIntersection(center1, step.radius1, center2, step.radius2, sign));
    capturedSigns.set(step.name, sign);
  }

  return { points, capturedSigns };
}

const signCache = new WeakMap<DyadChainSpec, ReadonlyMap<string, 1 | -1>>();

/**
 * Captures, once, which root of every intersection step's quadratic
 * reproduces `spec.referencePoints` at `spec.crank.referenceAngle` -- the
 * independent construction's own fixed branch definition (never "whichever
 * root is closer" at each sampled angle, which would silently hide a
 * branch jump). Memoized per `spec` object.
 */
export function captureSigns(spec: DyadChainSpec): ReadonlyMap<string, 1 | -1> {
  const cached = signCache.get(spec);
  if (cached) return cached;
  const { capturedSigns } = runChain(spec, spec.crank.referenceAngle, null);
  signCache.set(spec, capturedSigns);
  return capturedSigns;
}

/** Every named point's world position at `theta2`, on the branch fixed by `captureSigns`. */
export function solveDyadChain(spec: DyadChainSpec, theta2: number): Map<string, Vec2> {
  const signs = captureSigns(spec);
  return runChain(spec, theta2, signs).points;
}
