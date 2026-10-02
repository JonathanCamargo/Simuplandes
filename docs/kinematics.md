# Kinematic engine

The engine is in `simuplandes/src/kinematics/` (pure TypeScript) and is driven from `simuplandes/src/sim/`.

## Why a custom solver

v0.1 used matter.js, which enforces joints with soft, iterative constraints. Pins drift, and there is no way to prescribe a motor angle. That is fine for games but not for mechanism analysis. GraphThe also works purely kinematically, with coupler curves.

So kinematics came first, with an exact solver. Dynamics (masses, forces, contact) is deferred to v2. matter.js is still a dependency, but only the legacy code uses it.

Accuracy target: a loop-closure residual below 1e-9 (in model units) on every converged frame.

## Formulation

- **Coordinates:** absolute `q = [x_i, y_i, θ_i]` for every non-ground link. A link frame is defined by its pose at the reference (build) pose.
- **Revolute joint** (2 equations): `r_a + A(θ_a) s_a − r_b − A(θ_b) s_b = 0`.
- **Prismatic joint** (2 equations): a relative angle lock `θ_b − θ_a − Δθ_ref = 0`, and the point must stay on the owner's axis: `n_a(θ_a) · (p_b − p_a) = 0`.
- **Rotary motor** (1 equation): `θ_b − θ_a − φ(t) = 0`.
- **Linear motor** (1 equation): `u_a · (p_b − p_a) − d(t) = 0`.
- **Jacobians** are analytic. A finite-difference check is part of the test suite.

## One solver core

- There is one dense LU with partial pivoting, and one Levenberg–Marquardt-damped Newton routine (`newtonSolve`).
- The same routine handles per-frame continuation (λ ≈ 0, so it behaves like plain Newton) and assembly (larger initial damping, more iterations).
- It also handles over-determined consistent (redundant) topologies. There is no separate damped least-squares solver.
- Systems are small (fewer than about 40 unknowns, and at most around 12 links), so the solver runs on the main thread and reaches 60 steps/s or more on a 10-bar.

## Driving and continuation

- **`advanceDrive`** is a branch-preserving predictor–corrector. Each step starts from the previous `q` with a tangent predictor, and the step size adapts.
- **A step that fails is bisected.** When the step falls below its minimum, the engine reports a **lock-up** at that input. In Play, a rocking motor reverses direction there instead of jumping to another branch.
- **A predictor sanity check** rejects tangent blow-ups near folds, which would otherwise let Newton land on a different branch without warning. This was a real bug, found by a branch-preservation test.
- **Singularities** are monitored with σ_min/σ_max computed on a length-scaled Jacobian. The UI warns as the mechanism approaches a toggle position.

## Velocity and acceleration

- `J q̇ = ν` and `J q̈ = γ`. The γ formulas were derived by hand for all four constraint kinds.
- There is a mandatory finite-difference cross-check of γ.
- Kinematics are reported for every link and marker.

## Assembly and mobility

- **Assembly** runs the same damped Newton from an open guess. If the mechanism cannot close, the violated joints are reported by name.
- **Mobility:** Gruebler DOF (`F = 3(n−1) − 2j`, the headline number) and Jacobian-rank DOF are computed and reported **separately**. Neither is derived from the other, so a redundant bar shows `F = 0` while the rank still explains the actual motion.

## Motor expressions

`MotorDrive.expression` is parsed by an in-repo recursive-descent parser:

- It sees only the variable `t`, a whitelist of math functions, and the constants `pi` and `e`.
- It does not use `eval`, `new Function` or `expr-eval`.

`expr-eval` ≤ 2.0.2 has two unpatched High advisories (GHSA-jc85-fpwf-qm7x and GHSA-8gw3-rxh4-v6jx). Expressions come from `.simup.json` files that may be untrusted.

## Simulate-mode features built on the engine

These live in `src/sim/`:

- **Session** (`session.ts`): the primary motor is `motors[0]`. A document with no motor gets a temporary driver on the first ground–moving revolute joint. The session also runs the assembly and drivability checks.
- **Runtime** (`runtime.ts`): play, pause, step, reset, speed, loop and scrub, with rocking reversal and a time history. It runs outside React.
- **Drag-to-drive** (`kinematics/dragDrive.ts`, `sim/drag.ts`): this is inverse kinematics on the motor input. It estimates the input change from a tangent least-squares fit toward the pointer, then re-solves exactly with `advanceDrive`. Joints therefore never break (they hold to within 1e-6) during a drag.
- **Sweeps and traces:** forward and backward marches give the full reachable range and closed coupler curves.
- **Plots and CSV:** angle, position, velocity and acceleration against the input or time, exported as RFC 4180 CSV.
- **DOF badge:** the Gruebler number, colored by the rank DOF, with an explanation popover.

## Validation

The solver was checked against independent references:

- the Freudenstein four-bar
- analytic slider-crank and inverted slider-crank
- Watt and Stephenson six-bars, built independently as dyad constructions
- a synthetic 10-bar sweep
- a non-blocking `vitest bench`

The same solver produces the reference curves (`fixtures/*.curve.json`) that dms must match. See [graphthe-bridge.md](graphthe-bridge.md).
