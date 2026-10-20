# Dynamics

Simuplandes computes forces two ways:

- **Kinematics analysis** reports the forces the motion needs (inverse dynamics). The motor follows its prescribed motion as before, and every frame also gives the joint reactions, the motor torque or force, power and energy.
- **Dynamics analysis** integrates the equations of motion in time (forward dynamics). Motors can follow a motion or apply a torque or force. Gravity, springs, dampers and loads act on everything that is left free. The mechanism does not need to be fully driven: a double pendulum (2 DOF, no motor) is a valid model.

The code is in `simuplandes/src/dynamics/` (pure TypeScript). It builds on `src/kinematics/` and is driven from `src/sim/`.

## Model (schema v2)

The document gained these fields in schema v2 (`model/schema.ts`). A v1 file migrates by filling defaults.

| Field | Meaning | Units |
|-------|---------|-------|
| `link.massProperties` (optional) | `mass`, `com` (center of mass, link-local), `inertia` about the center of mass | kg, model units, kg·m² |
| `dynamics.gravity` | Gravity vector, world frame | m/s² (default `[0, -9.81]`) |
| `dynamics.barDensity`, `dynamics.plateDensity` | Densities behind computed mass properties | kg/m (default 0.5), kg/m² (default 10) |
| `motor.dynamics` | `{ mode: "motion" }` (default) or `{ mode: "effort", expression }` | N·m (rotary) or N (linear) |
| `springs[]` | `linear` (site to site): `stiffness`, `damping`, `freeLength`; `torsional` (on an R joint): `stiffness`, `damping`, `freeAngle` | N/m, N·s/m, model units; N·m/rad, N·m·s/rad, rad |
| `loads[]` | A constant force (world frame) and torque at a site | N, N·m |

**Mass properties.** A link without `massProperties` gets them computed from its shape (`model/massProperties.ts`). A bar is a chain of uniform slender rods through its sites, in site order. A plate is a uniform lamina over its outline. A link that has zero length and no custom mass has no mass at all. That is fine as long as the constraints fix its motion.

**Units.** Geometry stays in model units (mm or m). Dynamics converts to SI with `metersPerUnit`. Forces are always reported in N and N·m, whatever the length unit.

**Effort expressions** use the same safe parser as motor drives, with three variables: `t` (s), `q` (the joint's input coordinate: rad, or model units for a slider, 0 at the reference pose) and `dq` (its rate). For example, `-5*q - 0.2*dq` is a PD controller that holds the reference pose.

## Formulation

The coordinates are the kinematic ones: `q = [x, y, θ]` per moving link, where `(x, y)` is the link frame's origin, not its center of mass. With `s = R(θ)·com` in meters, each body contributes

```
M_body = [ m      0      −m s_y      ]      Q_v = m ω² [s_x, s_y, 0]
         [ 0      m       m s_x      ]
         [ −m s_y m s_x   I + m |s|² ]
```

`Q_v` is the velocity term that moves to the right-hand side because `d/dt perp(s) = −ω s`. Gravity acts at the center of mass. Loads, springs and dampers add point forces. Torsional springs and effort motors act along a joint coordinate (`dynamics/coordinates.ts`), so their generalized force is `effort · ∇coordinate`. The coordinates are defined exactly like the kinematic motor drivers.

Everything is assembled in **SI coordinates**. `colScale` converts each coordinate (metersPerUnit for x and y, 1 for θ), and `rowScale` converts each constraint row (metersPerUnit for a length row, 1 for an angle row). This keeps the matrix well conditioned for mm documents. Lagrange multipliers come out in N (length rows) or N·m (angle rows).

### One solve, three right-hand sides

```
[ M  Jᵀ ] [ a ]   [ top    ]
[ J  0  ] [ λ ] = [ bottom ]
```

| Use | `top` | `bottom` | Result |
|-----|-------|----------|--------|
| Forward dynamics (`forwardDynamics`) | `Q` | `γ` | accelerations and multipliers |
| Inverse dynamics (`inverseDynamics`) | `Q` | `J·a_known` | multipliers for a prescribed motion |
| Velocity projection (`projectVelocity`) | `M·v_guess` | `ν` | the constraint-satisfying velocity closest to `v_guess` in kinetic energy |

`J` includes the motion-driver rows, so a driven motor's multiplier is its effort. Because inverse dynamics is the same system, it always agrees with forward dynamics. A test checks this.

**Singular systems.** Redundant constraints (a double parallelogram, or a duplicated pin) make the matrix singular. The accelerations are still unique, but the multipliers are not. The solve detects a small pivot ratio and falls back to damped least squares on `K·K`, which returns the minimum-norm multipliers. It then reports `singular: true`, and the UI shows "the reactions are not unique". A massless link left free by the constraints takes the same path and gets zero acceleration in its free direction.

### Reading the multipliers (`dynamics/reactions.ts`)

- **Revolute joint:** the force on the siteB link is `+λ` and on the siteA link `−λ`.
- **Prismatic joint:** a normal force at siteB's point plus a couple.
- **Which link is reported:** the siteB link, or the siteA link when siteB's link is ground, so a reaction always describes a moving link. A prismatic couple is taken about the reported link's own joint site.
- **Motor effort:** `−λ` of its driver row, positive in the direction of increasing input. Power is effort times the joint rate.

## Forward dynamics (`dynamics/integrate.ts`)

- **Integrator:** classical RK4 on `(q, v)`, with fixed steps of at most 1 ms (`DEFAULT_MAX_STEP`).
- **Drift control by projection, not Baumgarte stabilization.** After each step, the kinematic `newtonSolve` pulls `q` back onto `Φ(q, t) = 0` (motion drivers at their `t` values). `projectVelocity` then makes `v` satisfy `J v = ν`. Nothing needs tuning, and the existing Newton solver does the position half.
- **Start:** positions are assembled for the drivers' values at `t = 0`. Velocities are projected from rest, so a constant-speed motor starts at its speed.
- **Stop reasons:** a step stops the trajectory on a non-finite effort (`invalid-effort`), an invalid drive (`invalid-drive`), a Newton failure (`projection-failed`, typically a motion driver pushing a mechanism past its lock), or a runaway rate (`diverged`).

Fixed-step RK4 is stable while `ω·h` stays below about 2.8. With 1 ms steps that allows natural frequencies up to roughly 2,800 rad/s, which is far stiffer than the default springs.

## Simulate mode

The transport leads with a **Kinematics / Dynamics** switch, stored in `simStore.analysis`.

**Kinematics** is unchanged, except that every measurement row also carries an inverse-dynamics frame (`plots.ts`'s `inverseDynamicsFrame`). The sweep table uses the nominal input rate. Scrubbing records rate-0 (quasi-static) values. In this mode every motor follows its motion, and effort settings are ignored.

**Dynamics** (`sim/dynamicsSession.ts`, `sim/trajectory.ts`, `runtime.ts`):

- **Session classification:** `createDynamicsSession` reports `ready` (with the free DOF), `empty`, `invalid`, `invalid-expression`, `assembly-failed` or `over-driven` (more motion motors than DOF).
- **Background integration:** a dynamic pose depends on its whole history, so time cannot be jumped to. The runtime integrates a `Trajectory` a few frames per animation tick (8 ms budget, at most 240 frames), even while paused, until the chosen duration (2–60 s, default 10) is covered.
- **Playback:** play, step, reset and the scrubber move a playhead over the frames that exist. Playback waits if it catches up with the computation, and loops or stops at the end.
- **Recording:** frames are recorded at 60 per simulated second. Each one stores its measurement row, so plots and CSV read the whole trajectory against time. Marker traces come from the trajectory.
- **Drag-to-drive is off.** Dragging would need live integration rather than a pre-computed buffer.

### Plot quantities

With dynamics, the plot picker adds:

| Entity | Quantities | Units |
|--------|------------|-------|
| Joint | reaction Fx, Fy, \|F\|; couple for a prismatic joint | N, N·m |
| Motor | torque (rotary) or force (linear), power | N·m or N, W |
| Linear spring | spring force (tension positive), length | N, model units |
| Torsional spring | spring torque, twist | N·m, ° |
| Mechanism | kinetic, potential (gravity, springs, loads) and total energy | J |

## Editing

- **Inspector, document:** gravity and densities.
- **Inspector, moving link:** mass properties (from shape or custom; switching to custom starts from the computed values) and its loads (site, Fx, Fy, torque).
- **Inspector, motor:** what it does in dynamics: follow its motion, or apply a torque or force expression.
- **Inspector, R joint:** its torsional springs, and an "Add torsional spring" button.
- **Spring tool** (rail, key K): two clicks connect two links. Each end can be an existing site or joint, a point on a link, or empty space, which anchors to ground. The free length is the drawn length, and the default stiffness is 100 N/m. The canvas draws linear springs as zigzags, torsional springs as spirals and loads as arrows.

## Validation

Every test is under `src/dynamics/` unless noted.

**Analytic checks:**

- a uniform rod released horizontally (`α = −3g/2l`), with its pin force
- the small-amplitude pendulum period
- the spring–mass oscillator, undamped and underdamped, against closed forms
- constant motor torque on a free rod (`θ = ½ τ/I t²`)
- holding torque and centripetal pin pull for a driven rod

**Consistency checks:**

- `½ vᵀMv` equals the kinetic energy
- conservative generalized forces equal `−∂V/∂q` (finite differences, mm and m)
- dampers dissipate power
- forward and inverse dynamics agree on accelerations and multipliers
- mm and m documents give the same forces
- joint-coordinate gradients match finite differences

**Integration checks:**

- energy is conserved over 3 s for a large pendulum swing, and over 2 s for a double pendulum, with joints closed to 1e-8
- redundant constraints flag a singular step and keep moving
- every stop reason is exercised

## Limitations

- There is no contact, friction or joint limits. matter.js is still only used by the legacy code.
- Loads are constant. Time-varying forces can be modelled with an effort motor.
- Integration uses a fixed step. A very stiff spring (natural frequency above about 2,800 rad/s) needs a smaller step, which is not exposed in the UI.
- A drag in Dynamics would need live integration ("mouse spring"), which is not implemented.
- GraphThe export ignores dynamics data. GraphThe is kinematic.
