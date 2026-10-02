/**
 * Non-blocking performance benchmark for Phase 3 success criterion 4: the
 * synthetic 10-bar (n = 27, 13 R joints) must solve a full frame (position
 * + velocity + acceleration + marker kinematics) at >= 60 steps/s. This
 * file is matched by `vite.config.ts`'s default `benchmark.include`
 * (`*.bench.ts`), not `test.include` (`*.test.{ts,tsx}`), so
 * `npm test`/`npm run check` never run it -- it is still linted and
 * type-checked. Run with:
 *
 *   npx vitest bench --run src/kinematics
 *
 * Vitest 5's benchmarking API is context-based (`test(name, ({ bench }) =>
 * ...)`, registration objects with an explicit `.run()`), not the
 * standalone top-level `bench(name, fn)` of earlier Vitest majors -- the
 * plan's own sketch used that older form, which does not exist in the
 * installed 5.0.1 (`no exported member named 'bench'`); this is the real,
 * installed API. The observed hz for both benches is recorded in
 * `03-03-SUMMARY.md`/`03-VALIDATION.md`, along with the machine/Node
 * context, per the plan -- never tuned or faked to hit the number.
 */
import { test } from "vitest";
import { compileSystem } from "../system";
import { referenceState, solvePosition, type SolvedState } from "../position";
import { advanceDrive } from "../singularity";
import { solveVelocityAcceleration } from "../velocity";
import { computeFrameKinematics } from "../query";
import { build as buildTenBar } from "../__fixtures__/tenBar";

const STEP = Math.PI / 180; // 1 degree per call
const ZERO_ACCEL = new Float64Array([0]);
const ONE_RATE = new Float64Array([1]);
const TWO_PI = 2 * Math.PI;

test("10-bar full frame (position + velocity + acceleration + markers)", async ({ bench }) => {
  const system = compileSystem(buildTenBar().doc);
  let state: SolvedState = referenceState(system);

  const advanceDriveBench = bench(
    "10-bar full frame via advanceDrive (position + velocity + acceleration + markers)",
    () => {
      const target = new Float64Array([(state.inputs[0] + STEP) % TWO_PI]);
      const result = advanceDrive(system, state, target);
      state = result.state;

      const rates = solveVelocityAcceleration(system, state.q, ONE_RATE, ZERO_ACCEL);
      computeFrameKinematics(system, state.q, rates.qDot, rates.qDDot);
    },
  );
  await advanceDriveBench.run();

  let plainState: SolvedState = referenceState(system);
  const solvePositionBench = bench("10-bar full frame via plain solvePosition (comparison)", () => {
    const target = new Float64Array([(plainState.inputs[0] + STEP) % TWO_PI]);
    const result = solvePosition(system, plainState, target);
    plainState = result.state;

    const rates = solveVelocityAcceleration(system, plainState.q, ONE_RATE, ZERO_ACCEL);
    computeFrameKinematics(system, plainState.q, rates.qDot, rates.qDDot);
  });
  await solvePositionBench.run();
});
