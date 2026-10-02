/**
 * The shared sweep contract (identical algorithm to be implemented by dms
 * in 07-02, see `07-03-PLAN.md`'s `<sweep_contract>`), run over the Phase 3
 * solver (`src/kinematics`): `sweepFixture` marches a fixture's input link
 * through 360 absolute grid angles, forward then backward from the
 * reference pose, and emits exactly the `<curve_file>` JSON shape dms's
 * `test_parity.py` will read.
 */

import {
  evalResidual,
  compileSystem,
  linkPose,
  referenceState,
  solvePosition,
} from "../../src/kinematics";
import type { SolvedState, KinematicSystem } from "../../src/kinematics";
import { rotate, add, vec2 } from "../../src/geom";
import type { MechanismDocument } from "../../src/model";
import { gtmToDocument, thetaRefOf, sizeOf, type GtmFixture } from "./fixture";

const TWO_PI = 2 * Math.PI;
const MAX_HALVINGS = 6;
const REFERENCE_TOLERANCE = 1e-6;

/** The reachable range of the input link's absolute angle. */
export interface ReachableRange {
  readonly kind: "full-rotation" | "bounded" | "none";
  readonly thetaMin: number;
  readonly thetaMax: number;
}

/** The checked-in `*.curve.json` shape: everything dms's `test_parity.py` reads. */
export interface CurveFile {
  readonly format: "simuplandes-parity-curve";
  readonly version: 0;
  readonly fixture: string;
  readonly fixtureSha256: string;
  readonly generator: string;
  readonly nSamples: number;
  readonly grid: string;
  readonly thetaRef: number;
  readonly size: number;
  readonly reachable: ReachableRange;
  readonly markers: ReadonlyArray<ReadonlyArray<readonly [number, number] | null>>;
  readonly joints: Readonly<Record<string, ReadonlyArray<readonly [number, number] | null>>>;
}

/** Options for `sweepFixture`. `fixtureFileName`/`fixtureSha256` describe the source file on disk. */
export interface SweepOptions {
  readonly nSamples?: number;
  readonly fixtureFileName?: string;
  readonly fixtureSha256?: string;
}

function mod2pi(x: number): number {
  const r = x % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

function buildGrid(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (TWO_PI * i) / n);
}

/** The first grid index `i` with `grid[i] >= value` (mod 2*pi); `0` if none (wraps). */
function findFirstAtOrAbove(grid: readonly number[], value: number): number {
  const eps = 1e-9;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] >= value - eps) return i;
  }
  return 0;
}

/** The last grid index `i` with `grid[i] < value`; the final index if none. */
function findLastBelow(grid: readonly number[], value: number): number {
  const eps = 1e-9;
  for (let i = grid.length - 1; i >= 0; i--) {
    if (grid[i] < value - eps) return i;
  }
  return grid.length - 1;
}

function vecNorm2(v: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

function linkIndexForNode(doc: MechanismDocument, nodeId: number): number {
  const idx = doc.links.findIndex((l) => l.name === `link-${nodeId}`);
  if (idx === -1) throw new Error(`sweepFixture: no link for node ${nodeId}`);
  return idx;
}

function siteLocalForEdge(
  doc: MechanismDocument,
  ownerNode: number,
  otherNode: number,
): readonly [number, number] {
  const idx = linkIndexForNode(doc, ownerNode);
  const site = doc.links[idx].sites.find((s) => s.name === `n${otherNode}`);
  if (!site) throw new Error(`sweepFixture: no site n${otherNode} on link for node ${ownerNode}`);
  return site.local;
}

function worldFromPoseLocal(
  pose: { x: number; y: number; angle: number },
  local: readonly [number, number],
): readonly [number, number] {
  const rotated = rotate(vec2(local[0], local[1]), pose.angle);
  const world = add(rotated, vec2(pose.x, pose.y));
  return [world.x, world.y];
}

/**
 * Runs the shared sweep contract over `src/kinematics`, from `fx`'s
 * reference pose (`referenceState`, motor input 0). No random restarts.
 */
export function sweepFixture(fx: GtmFixture, options: SweepOptions = {}): CurveFile {
  const nSamples = options.nSamples ?? 360;
  const doc = gtmToDocument(fx);
  const system: KinematicSystem = compileSystem(doc);
  const thetaRef = thetaRefOf(fx);
  const size = sizeOf(fx);

  const ref = referenceState(system);
  const refResidual = new Float64Array(system.jointRows);
  evalResidual(
    system,
    ref.q,
    new Float64Array(system.motors.length),
    refResidual,
    system.jointRows,
  );
  const refConverged = vecNorm2(refResidual) <= REFERENCE_TOLERANCE;

  const grid = buildGrid(nSamples);
  const states: (SolvedState | null)[] = new Array<SolvedState | null>(nSamples).fill(null);
  const targets: (number | null)[] = new Array<number | null>(nSamples).fill(null);
  let forwardSolved = 0;

  if (refConverged) {
    const thetaRefWrapped = mod2pi(thetaRef);

    // Forward pass: from the reference, targets increasing (unwrapped).
    const i0 = findFirstAtOrAbove(grid, thetaRefWrapped);
    let prev = ref;
    for (let k = 0; k < nSamples; k++) {
      const idx = (i0 + k) % nSamples;
      const phi = mod2pi(grid[idx] - thetaRef);
      const result = solvePosition(system, prev, Float64Array.of(phi), {
        maxHalvings: MAX_HALVINGS,
      });
      if (result.status !== "ok") break;
      states[idx] = result.state;
      targets[idx] = thetaRef + phi;
      prev = result.state;
      forwardSolved++;
    }

    // Backward pass: from the reference again, targets decreasing (unwrapped).
    const j0 = findLastBelow(grid, thetaRefWrapped);
    prev = ref;
    for (let k = 0; k < nSamples; k++) {
      const idx = (((j0 - k) % nSamples) + nSamples) % nSamples;
      if (states[idx] !== null) break;
      const phi = -mod2pi(thetaRef - grid[idx]);
      const result = solvePosition(system, prev, Float64Array.of(phi), {
        maxHalvings: MAX_HALVINGS,
      });
      if (result.status !== "ok") break;
      states[idx] = result.state;
      targets[idx] = thetaRef + phi;
      prev = result.state;
    }
  }

  // Per the sweep contract: "none" only if the reference pose itself
  // fails; otherwise the non-full-rotation case is always "bounded" (even
  // if, in a degenerate case, no grid sample besides the reference solves).
  const solvedTargets = targets.filter((t): t is number => t !== null);
  const kind: ReachableRange["kind"] = !refConverged
    ? "none"
    : forwardSolved === nSamples
      ? "full-rotation"
      : "bounded";

  const reachable: ReachableRange =
    kind === "full-rotation"
      ? { kind, thetaMin: thetaRef, thetaMax: thetaRef + TWO_PI }
      : kind === "bounded" && solvedTargets.length > 0
        ? { kind, thetaMin: Math.min(...solvedTargets), thetaMax: Math.max(...solvedTargets) }
        : { kind, thetaMin: thetaRef, thetaMax: thetaRef };

  const markers: (readonly [number, number] | null)[][] = system.markers.map((marker) =>
    states.map((state) => {
      if (!state) return null;
      const pose = linkPose(system, state.q, marker.linkIndex);
      return worldFromPoseLocal(pose, [marker.local.x, marker.local.y]);
    }),
  );

  const sortedEdges = [...fx.graph.edges].sort((a, b) => {
    const au = Math.min(a.source, a.target);
    const av = Math.max(a.source, a.target);
    const bu = Math.min(b.source, b.target);
    const bv = Math.max(b.source, b.target);
    return au - bu || av - bv;
  });

  const joints: Record<string, (readonly [number, number] | null)[]> = {};
  for (const edge of sortedEdges) {
    const u = Math.min(edge.source, edge.target);
    const v = Math.max(edge.source, edge.target);
    const key = `${u}-${v}`;
    const linkIndex = linkIndexForNode(doc, u);
    const local = siteLocalForEdge(doc, u, v);
    joints[key] = states.map((state) => {
      if (!state) return null;
      const pose = linkPose(system, state.q, linkIndex);
      return worldFromPoseLocal(pose, local);
    });
  }

  return {
    format: "simuplandes-parity-curve",
    version: 0,
    fixture: options.fixtureFileName ?? `${fx.name}.gtm.json`,
    fixtureSha256: options.fixtureSha256 ?? "",
    generator: "simuplandes/scripts/gen-curves.ts (src/kinematics solvePosition)",
    nSamples,
    grid: `theta_i = 2*pi*i/${nSamples}, absolute input-link angle (rad)`,
    thetaRef,
    size,
    reachable,
    markers,
    joints,
  };
}
