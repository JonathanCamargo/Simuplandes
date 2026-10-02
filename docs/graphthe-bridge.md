# The GraphThe bridge

This page covers how a drawing becomes a graph and back, and what changed in dms and GraphThe to make the round trip exact. The byte-level format rules are in [`simuplandes/fixtures/README.md`](../simuplandes/fixtures/README.md). This page gives the picture and the reasons.

## Graph model

- **Links are nodes and joints are edges.** There is a single ground node `0`, which matches GraphThe exactly.
- **Every fixed body in the drawing merges into node 0.** Without this, Gruebler mobility and GraphThe's features would be wrong.
- **`link_type` comes from a node's degree:** ground, binary, ternary, quaternary or pentary. GraphThe's palette is reused in the graph panel and as the link tint on the canvas.
- **Parallel joints are not allowed.** GraphThe uses a simple `nx.Graph`, so a second joint between the same pair of links is not exported, and the export report warns about it.

## Reference-pose joint positions are the source of truth

The key decision is that the world position of every joint at the reference pose fully defines every link's rigid geometry.

This has three consequences:

- **The format is lossless for plates.** GraphThe's single `length` per link cannot describe a ternary or larger plate; joint positions can.
- **The mechanism is assembled by construction.** The residual is about 0 at the reference pose, so no solve is needed to rebuild the drawing.
- **The same data drives everything.** It feeds the Simuplandes export, dms `from_joint_positions`, the parity fixtures and GraphThe's geometry-mode sampler.

A topology-only graph has no positions, so it needs a layout. See [Import](#import) below.

## Interchange format (`*.graphthe.json`, v1)

The format is a `simuplandes-graphthe-export` envelope around a standard NetworkX node-link `graph`. Python loads it with no custom code:

```python
G = nx.node_link_graph(doc["graph"], edges="edges")   # NetworkX >= 3.6
```

| Rule | Why |
|------|-----|
| `directed: false` and `multigraph: false` are written explicitly | NetworkX defaults to `multigraph=True`. Leaving the key out would silently load a `MultiGraph`. |
| Fixed key order, nodes sorted by `id`, edges sorted by `(source, target)` with `source < target`, and output always written with `JSON.stringify(…, null, 2) + "\n"` | Export → import → export is **byte-identical**, so golden files can be compared byte for byte. |
| Positions are world coordinates as drawn: no shift, rotation, normalization or unit conversion | Normalization is GraphThe's job, and its curve encoding is already invariant to it. |
| A prismatic edge carries `type: "prismatic"` and a world `axis` owned by the lower node id | The same convention as dms's owner and slider sides. |
| `input: true` marks motor edges; markers are absolute points | Matches dms geometry-mode conventions. |
| The Simuplandes extras are `name`, `units`, `source` and `link_names` | GraphThe can ignore them. Merged ground links keep their names. |

The older `.gtm.json` (v0 parity fixture) is a subset of this format, and the reader accepts both.

## Export

**Where it happens:** `src/interchange/graphthe.ts`, `validate.ts`, `multiJoint.ts`, and the Export tab in the right dock.

**Warn, but always write.** The validation report flags problems, but the file is always written so the user can take it elsewhere.

**Errors** are things GraphThe cannot simulate:

- DOF ≠ 1 on the exported graph
- no motor, or several motors
- a motor not on a ground pivot
- a linear motor

**Warnings:**

- a parallel joint
- a dangling joint
- a node whose degree dms's atlas classifier cannot label

**Info:** fixed bodies that were merged into ground.

Clicking an item in the report highlights the related object on the canvas.

**Multi-joints** are three or more links pinned at one point. They export as a canonical **star** of binary edges around a hub at that point:

- The hub is ground if ground takes part. Otherwise it is the participant with the most joints, with ties going to the lowest id.
- A re-imported star exports again byte for byte.
- Prismatic joints never take part in grouping, because a slider's R and P joints coincide at the reference pose by design.

**Other exports:**

- **JSON:** Copy and Download buttons, with a live preview.
- **Images:** the drawing and the graph as SVG (transparent) or PNG (opaque white, 2×). A "Print (light)" switch exports the light theme even when the app is in dark mode.

## Import

**Where it happens:** `src/interchange/{readGraph,planImport,importGraphthe,buildDocument,layoutSeed}.ts`, `src/sim/{autoLayout,mobilityRange,lengthTarget}.ts`, and the import dialog.

**Entry points:**

- File → Import
- dropping a file onto the canvas
- pasting into the dialog
- File → Open, which routes graph files to the import dialog. Save never overwrites a graph file.

**Accepted input:**

- v1 envelopes
- v0 fixtures
- bare NetworkX node-link dicts, with `edges` (NetworkX ≥ 3.6) or `links` (older NetworkX)

Each edge may carry `pos`, `type`, `axis` and `input`. Link lengths may be given per node or as a top-level map. The length-key names are an assumption: GraphThe has no JSON writer yet, so they follow its in-memory `link_lengths` convention.

**Pipeline:**

1. **Read** the input tolerantly, then **plan** with `planImport`. Planning is pure and can be re-run. It produces a report in which every warning comes with a **fix**, and applying a fix re-plans.
2. **Position the joints:**
   - **If positions are present,** the joints go exactly where the file says. The result is assembled by construction and moves immediately.
   - **If the graph is topology-only,** a seeded multi-start auto-layout places them (see below).
3. **Choose the input.** With no `input` in the file, GraphThe's convention applies: the first binary neighbor of ground.
4. **Preview.** The dialog shows the Drawing and the Graph (built in throwaway stores), a verdict chip, and progress with a cancel button. Nothing reaches the document until **Import** is pressed, and then it lands as one undoable commit.

**Auto-layout details:**

- It tries circle and midpoint seeds, filters out degenerate layouts, and runs a cheap **mobility gate** that requires rank DOF 1 and at least 60° of motion.
- If lengths are given, it fits the layout to them by least squares, using GraphThe's rule that a link's length is its maximum pairwise joint distance.
- It is seeded, so the same graph always gives the same drawing. "Try another layout" re-seeds.
- All 18 atlas topologies lay out successfully. The worst case took about 1.7 s, so the layout runs at import time rather than being precomputed.

## Atlas and examples

- **The atlas** is a frozen 6/8-bar export of dms's `TopologyAtlas`, made with the offline `scripts/export-atlas.py`.
- **Topology identification** (`src/graph/`) uses Weisfeiler–Lehman color refinement as a fast invariant, then a VF2-style backtracking isomorphism check. Both were written from scratch and are tested to give the same answer under relabeling.
- **The atlas browser** shows thumbnails, filters by link count and by class, and opens a topology with one click through the topology-only import path.
- **The examples gallery** (empty state and File menu) holds five measured fixtures: a four-bar, a slider-crank, Watt, Stephenson and an 8-bar. A unit test checks that each one has at least 60° of motion.

## dms changes (`dynamics_of_mechanical_systems`)

**The problem (verified 2026-09-22):** `NBarMechanism` modeled each link as one scalar length and one angle.

- A ternary link that appears in two loops reused the same vector, which forced its joints onto a single line.
- The ground pivots landed on the x-axis.
- `ComputePoints` placed joints with a drawing heuristic, so the positions it reported were not rigid. On a Stephenson six-bar, the distance between two joints of the coupler went 1.625 → 1.001 → 0.445 over 10° of crank.

An exported 6/8/10-bar would therefore have been simulated as a different mechanism. For that reason dms was fixed **before** the export bridge was built.

**The fix (Phases 7 and 7.1):**

- **New constructor:** `NBarMechanism.from_joint_positions(G, joint_positions, input_link=None, markers=None, joint_types=None, axes=None)`. Each link gets local joint coordinates, and each loop term becomes `A(θ_k)(s_out − s_in)`.
- **Same class.** `FK`, `ComputePoints`, `GetTrajectory` and `Animate` keep their signatures.
- **Length-only mode is frozen bit for bit.** A golden snapshot test guards it. It emits a one-time warning when a link has three or more joints.
- **Input angle:** `FK(theta1)` takes the absolute world angle of the input-link vector, with `mech.theta_ref` at the reference pose. In Simuplandes, `φ = θ − θ_ref`.
- **Deterministic results.** Tracking warm-starts from the reference pose with no random restarts. `GetTrajectory` keeps 360 samples with NaN where there is no solution, plus `reachable_range`.
- **Public setters** (`set_lengths`, `set_geometry`, `set_markers`, `reset_guess`) reuse the compiled solver. The Grashof pre-filter now works per loop.
- **Prismatic joints** have an owner (rail) side and a slider side. A linear input works at the FK/`ComputePoints` level only: `GetTrajectory`/`Animate` raise `NotImplementedError` for a linear input. This scope was decided by the user.
- **Tests:** a new pytest suite with hypothesis property tests for rigidity on random 6/8-bar geometries. It had 190 tests at the end of Phase 7.1.

## GraphThe changes

- The sampler, the animation code and the GUI atlas browser run dms geometry mode through **public setters only**. There is no private-attribute access left.
- Geometry-mode dataset sampling draws joint positions at a reference pose, with filters for minimum separation and plate collinearity. Lengths and plate shapes follow from the positions. `--mode geometry` is available in the dataset scripts.
- **`graphthe/io/mechanism_json.py`** loads v1 and v0 files into a `LoadedMechanism`:
  - `.pyg_inputs()` returns inputs that `mechanism_to_pyg` accepts unchanged.
  - `.build_mechanism()` returns a geometry-mode dms mechanism, sliders included.
- **Limitation:** `mechanism_to_pyg` encodes a prismatic edge the same way as a revolute one. Sliders are fully represented only through `.build_mechanism()`.

## Shared fixtures and the parity contract

**Simuplandes owns `simuplandes/fixtures/`.** Copies are pushed to the other repos by script, so no repo needs another at test time.

| Files | Produced by | Consumed by |
|-------|-------------|-------------|
| `*.gtm.json` (15 mechanisms: four-bars, Watt/Stephenson inversions, three 8-bars, two 10-bars, slider-crank, inverted slider-crank) | Written by hand, then checked with `validateGtmFixture` | dms, GraphThe |
| `*.curve.json` | `npm run fixtures:curves` (the Simuplandes solver, using the shared sweep contract) | dms parity tests |
| `*.graphthe.json` | `npm run fixtures:exports` | GraphThe contract tests, and the JS round-trip test |

**Pass bars:**

- **Curves:** within 1e-6 × mechanism size at 360 input angles, with the reachable range matching to one sample. The achieved worst case was 1.03e-9 × size.
- **Rigidity:** every pair of joints on a link keeps its distance to within 1e-9 relative.
- **Exports:** byte-identical round trip.

**Changing a fixture:**

1. Edit the `.gtm.json`.
2. Regenerate: `npm run fixtures:curves` and `npm run fixtures:exports`.
3. Sync: `npm run fixtures:sync` (dms) and `npm run fixtures:sync:graphthe` (GraphThe).
4. Run pytest in both repos.

Both generators have a `--check` mode that fails when the checked-in files are stale.
