# Parity fixtures (DMS-03, DMS-06)

This directory holds the canonical revolute + prismatic parity fixtures
shared by Simuplandes and the `dms` Python package
(`dynamics_of_mechanical_systems`). Simuplandes owns the fixtures; `dms`'s
test suite only ever _reads_ copies of them (via `npm run fixtures:sync`) and
never needs Node.

## `.gtm.json` fixture schema

"gtm" = "geometry-test-mechanism". This is a **minimal, forward-compatible
subset** of the future NetworkX node-link interchange JSON that Phase 8 will
define for real (`XCH-01`) — it is deliberately small and is **not** the
final interchange schema. It is a plausible subset (nodes with an optional
`link_type`, edges with a `pos` and an optional `input`/`marker`), so Phase 8
is likely to extend it rather than replace it, but that is not guaranteed.

```json
{
  "format": "simuplandes-parity-fixture",
  "version": 0,
  "name": "stephenson-iii",
  "description": "Stephenson chain, ground = ternary; ...",
  "graph": {
    "nodes": [{ "id": 0, "link_type": "ground" }, { "id": 1, "link_type": "binary" }, "..."],
    "edges": [
      { "source": 0, "target": 1, "pos": [0, 0], "input": true },
      { "source": 1, "target": 2, "pos": [20, 34.64] },
      { "source": 0, "target": 3, "pos": [154.22, 10], "type": "prismatic", "axis": [1, 0] },
      "..."
    ]
  },
  "markers": [{ "link": 2, "pos": [51.5, 84.1] }]
}
```

- `graph.nodes` are **links** (rigid bodies); `id: 0` is always ground.
  `link_type` is documentation only (`ground`/`binary`/`ternary`/`quaternary`/
  `slider`/`block`/...) — never read by the solver, which derives the real
  degree from the edges.
- `graph.edges` are **joints**: revolute (default, omit `type`) or
  prismatic (`"type": "prismatic"` plus a non-zero, finite `axis`). `pos` is
  the joint's WORLD position at the fixture's reference pose — the same
  convention as this project's own interchange decision ("reference-pose
  joint positions are lossless and branch-free", `PROJECT.md`). Both
  endpoint links record this exact point (for a prismatic edge, the point
  where the owner-side and slider-side coincide at reference); the fixture
  is therefore assembled by construction (residual ≈ 0 at `q0`), with no
  solving needed to produce it.
  - `axis` is a **world direction at the reference pose**, owned by the
    **lower-numbered node** `u` of the edge `(u, v)`, `u < v` (e.g. ground
    owns the axis whenever it's one of the two nodes). `gtmToDocument`
    converts it into `u`'s link-local frame (rotating by `-pose.angle`; a
    direction, never translated) for the emitted `PrismaticJointSchema`
    joint's `axis`.
  - The input edge (`"input": true`) must be revolute — a prismatic input
    edge is rejected by `parseGtmFixture` (linear-input fixtures are not
    part of this parity sweep contract; out of scope per Phase 7.1's own
    locked scope decision).
  - `validateGtmFixture`'s `coincident-joints` check skips any joint pair on
    one link when either joint is prismatic — a slider/block link's
    revolute and prismatic joints are _intentionally_ coincident at the
    reference pose (that's what "a pin sliding in a rail" means); it still
    flags two REVOLUTE joints of one link at the same point.
- Exactly one edge has `"input": true`, and it must touch node 0. The
  **input link** is that edge's other endpoint. The **input-link vector**
  (defines `theta_ref`, identical rule in `dms`) goes from the ground pivot
  `J(0, inputLink)` to the joint shared with the input link's
  lowest-numbered non-ground neighbor.
- `markers[].pos` are absolute reference-pose points (`dms` geometry-mode
  convention), converted to link-local via `worldToLinkLocal` when building
  the `MechanismDocument`.

## The six-bar naming used here

Both dms's `TopologyAtlas` and this project call the ground-adjacent-ternary
topology "Stephenson III" and "Watt II" (see
`src/kinematics/__fixtures__/sixBars.ts`). This plan's fixtures use, for the
two remaining Stephenson groundings:

- **stephenson-i**: ground is a **binary link adjacent to BOTH ternaries**
  (the "crank"/"rocker" position in `stephenson-iii`'s own labeling — either
  works; this plan grounds what `stephenson-iii` calls the crank).
- **stephenson-ii**: ground is a **binary link on the longer 3-link path**
  between the two ternaries (what `stephenson-iii` calls `L6`, on the
  `coupler -> L5 -> L6 -> hub` path).

`watt-i` (ground = a binary crank) and `watt-ii` (ground = the ternary hub)
are the equivalent groundings of the Watt six-bar (dms atlas `T6B_W`).

**Important:** `watt-i`/`stephenson-i` are built by _kinematic inversion_ of
`watt-ii`/`stephenson-iii`: the exact same reference-pose joint positions,
just declaring a different link as fixed. This is always valid (assembly
only depends on relative joint positions, never on which link is "ground"),
and because the _inverted_ pair's driven relative angle is the same pair
driven in the original, both fixtures are full-rotation, matching their
un-inverted counterpart. `stephenson-ii` inverts to a **different** driven
pair (the `O6` joint, not `O2`), so its reachable range had to be measured,
not assumed — it comes out bounded (~26°).

## `fixtures:curves` regeneration

```
npm run fixtures:curves          # writes fixtures/*.curve.json
npx tsx scripts/gen-curves.ts --check   # verify checked-in curves are fresh (no writes)
```

For every `fixtures/*.gtm.json` (sorted): parse → `validateGtmFixture` (any
issue aborts) → `sweepFixture` (the shared sweep contract, below) →
`fixtures/<stem>.curve.json`.

### The shared sweep contract

Implemented identically by Simuplandes (`scripts/gtm/sweep.ts`, over
`src/kinematics`'s `solvePosition`) and by `dms` (07-02, over its own
solver):

1. Grid: `N = 360`; `theta_i = 2*pi*i/N`, `i = 0..N-1`, ABSOLUTE input-link
   angles.
2. Start: the reference pose (`referenceState`, motor input 0).
   `phi = theta - theta_ref`.
3. Forward pass: unwrapped targets starting at the first grid point at or
   after `theta_ref` (mod 2π), stepping to each subsequent grid point in
   order (wrapping all the way around once). Stops at the first failed
   step.
4. Backward pass: from the reference again, targets decreasing from the
   grid point just below `theta_ref`, unwrapped downward. Stops at the
   first failure OR once the next grid index was already solved by the
   forward pass.
5. A step "fails" when the solver does not converge after up to 6
   step-halvings.
6. `kind = "full-rotation"` if all 360 samples solved in the forward pass
   alone; else `"bounded"` (`thetaMin`/`thetaMax` = the smallest/largest
   unwrapped target actually solved); `"none"` only if the reference pose
   itself fails.
7. No random restarts.

### The curve file

`fixtures/<stem>.curve.json`: `fixtureSha256` is the SHA-256 of the fixture
file's text with `\r\n` normalized to `\n` first. `markers` is one array per
fixture marker (in document order), each 360 `[x, y] | null` entries.
`joints` is keyed `"u-v"` (`u < v`, the fixture's own node ids), each also
360 `[x, y] | null` entries — the joint's world position at
`linkPose(system, q, link(u))` composed with that joint's local site on
link `u`. For a REVOLUTE edge either endpoint link gives the same point at
convergence, by construction (both sites always coincide). For a PRISMATIC
edge `joints["u-v"]` is always link `u`'s own point — the axis-owner side
(the same convention `dms` maps to `G{v}`/`J{u}_{v}`); it does NOT track the
sliding side, which generally moves away from it (e.g. `sweep.ts`'s
`sweepFixture`, unchanged by this schema extension, is joint-type-agnostic
here — `siteLocalForEdge` always reads link `u`'s own site).

## Workflow for changing a fixture

1. Edit/add a `fixtures/*.gtm.json` (then `npx prettier --write
fixtures/*.gtm.json`).
2. `npm run fixtures:curves` to regenerate its `*.curve.json`.
3. `npm run fixtures:sync` to copy both into the `dms` repo's
   `tests/fixtures/` (destination via `--dest`, `DMS_REPO`, or the
   hardcoded dev default — refuses to run outside a real `dms` checkout).
4. In `dms`: `pytest tests/test_parity.py`.

## The 15 fixtures

| name                     | topology                                                                 | ground                             | kind          | range |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------- | ------------- | ----- |
| `fourbar-crank-rocker`   | four-bar, Grashof                                                        | binary (crank input)               | full-rotation | 360°  |
| `fourbar-double-rocker`  | four-bar, non-Grashof                                                    | binary                             | bounded       | ~104° |
| `watt-i`                 | Watt six-bar (`T6B_W`)                                                   | binary crank                       | full-rotation | 360°  |
| `watt-ii`                | Watt six-bar (`T6B_W`)                                                   | ternary hub                        | full-rotation | 360°  |
| `stephenson-i`           | Stephenson six-bar (`T6B_S`)                                             | binary, adjacent to both ternaries | full-rotation | 360°  |
| `stephenson-ii`          | Stephenson six-bar (`T6B_S`)                                             | binary, on the 3-link path         | bounded       | ~26°  |
| `stephenson-iii`         | Stephenson six-bar (`T6B_S`)                                             | ternary hub                        | full-rotation | 360°  |
| `stephenson-iii-bounded` | Stephenson six-bar, non-Grashof base                                     | ternary hub                        | bounded       | ~146° |
| `eightbar-T01`           | dms atlas eightbar T01 (`[4,4,0,0]`)                                     | ternary                            | bounded       | ~21°  |
| `eightbar-T10`           | dms atlas eightbar T10 (`[5,2,1,0]`)                                     | quaternary                         | bounded       | ~32°  |
| `eightbar-T15`           | dms atlas eightbar T15 (`[6,0,2,0]`)                                     | quaternary                         | bounded       | ~229° |
| `tenbar-a`               | hand-built 10-bar (Stephenson base + 2 RRR dyads, all-ternary extension) | ternary hub                        | bounded       | ~262° |
| `tenbar-b`               | hand-built 10-bar (Stephenson base + 2 RRR dyads, one quaternary link)   | ternary hub                        | bounded       | ~304° |
| `slider-crank`           | offset slider-crank (ground owns the prismatic rail)                     | ground (crank input)               | full-rotation | 360°  |
| `inverted-slider-crank`  | inverted slider-crank / crank-shaper (rocker owns the prismatic slot)    | ground (crank input)               | full-rotation | 360°  |

Every link with 3+ joints (ground included) is non-collinear by
construction (`validateGtmFixture`'s `collinear-plate` check enforces this),
so every one of these fixtures would fail under the old scalar-length
collinear model — that is the entire point of DMS-01/DMS-02.

`slider-crank`/`inverted-slider-crank` (DMS-06) are ported verbatim from
`src/kinematics/__fixtures__/{sliderCrank,invertedSliderCrank}.ts` (crank=40,
coupler=120, offset=10 / crank=40, `O4=(0,-100)`, reference crank angle 30°
in both) — both already validated to analytic/FD precision in Phase 3. Each
has a marker on both the axis-owner link (coupler / rocker) and the
non-owner slider/block link.

## GraphThe export (v1) - `*.graphthe.json`

`fixtures/<stem>.graphthe.json` is the checked-in GOLDEN EXPORT of the same
fixture through Simuplandes' `simuplandes-graphthe-export` v1 envelope
(08-01, XCH-01/XCH-04). One per `.gtm.json`; regenerated by
`npm run fixtures:exports` and freshness-checked by the same script's
`--check` mode plus `src/interchange/roundtrip.test.ts`.

The v1 envelope is a NetworkX node-link-shaped SUPERSET of the `.gtm.json`
v0 schema above: same `graph.nodes`/`graph.edges`/`markers` shapes and the
exact same world-frame conventions (reference-pose joint `pos`, prismatic
`type: "prismatic"` + world `axis` owned by the lower node id, absolute
marker points), plus explicit metadata. Python loads it with
`nx.node_link_graph(doc["graph"], edges="edges")` (NetworkX >= 3.6).

```json
{
  "format": "simuplandes-graphthe-export",
  "version": 1,
  "name": "my mechanism",
  "units": "mm",
  "source": { "app": "Simuplandes", "version": "0.1.0" },
  "graph": {
    "directed": false,
    "multigraph": false,
    "graph": {},
    "nodes": [
      { "id": 0, "link_type": "ground", "link_names": ["ground A", "ground B"] },
      { "id": 1, "link_type": "binary", "link_names": ["crank"] }
    ],
    "edges": [
      { "source": 0, "target": 1, "pos": [0, 0], "input": true },
      { "source": 0, "target": 3, "pos": [154.2, 10], "type": "prismatic", "axis": [1, 0] }
    ]
  },
  "markers": [{ "link": 2, "pos": [51.5, 84.1], "name": "marker-0" }]
}
```

Rules (all enforced by `src/interchange/graphtheSchema.ts` and tested by
`src/interchange/{graphthe,roundtrip}.test.ts`):

- Key order exactly as shown: top level `format, version, name, units,
source, graph, markers`; node `id, link_type, link_names`; edge
  `source, target, pos, input?, type?, axis?`; marker `link, pos, name`.
  Serialization is always `JSON.stringify(envelope, null, 2) + "\n"` --
  never hand-formatted or rounded, so export -> import -> export is
  byte-identical.
- `directed: false` and `multigraph: false` are EXPLICIT (NetworkX's own
  `node_link_graph` default for `multigraph` is `true` -- omitting it
  would silently load a `MultiGraph`). The nested `graph: {}` holds
  graph-level attributes (unused).
- `source < target` on every edge; edges sorted by `(source, target)`
  ascending; nodes sorted by `id` ascending; node 0 is always the merged
  ground (every `isGround` link), moving links are `1..n-1` in document
  order.
- `link_type` is REQUIRED DATA in v1 (GraphThe's `mechanism_to_pyg` reads
  it directly; the v0 "documentation only" note above applies to dms's
  parity path only): `"ground"` for node 0, else the degree classifier
  binary/ternary/quaternary/pentary (Simuplandes'
  `linkTypeForJointCount`). v0-era descriptive labels such as
  `"slider"`/`"block"` are superseded by the degree rule -- the slider
  node exports as `"binary"`; the prismatic edge itself carries the
  joint-type information.
- World frame as drawn: joint `pos`, marker `pos` and prismatic `axis`
  are the reference-pose world values -- no shift, rotation,
  normalization or unit conversion. `units` is a label only.
- A prismatic edge carries `type: "prismatic"` + `axis` (the same key
  naming as `.gtm.json` above); a revolute edge omits both. `input: true`
  appears only on motor-joint edges.
- `link_names[0]` is each node's display name; node 0 carries every
  merged ground link's name in document order. Markers keep document
  order and their `name` (v0 files have no marker names -- the importer
  defaults to `marker-<i>`).
- The reader accepts BOTH the v1 envelope and the v0
  `simuplandes-parity-fixture` shape above (normalized to v1:
  `directed/multigraph/graph` keys filled in, no `units`/`source`/
  `link_names`/marker names). Unlike v0's parity rules it does NOT
  require exactly one `input` edge nor reject a prismatic input edge --
  warn-but-allow exports must stay readable.

### Regeneration & sync

```
npm run fixtures:exports            # writes fixtures/*.graphthe.json
npx tsx scripts/gen-graphthe-exports.ts --check   # verify goldens are fresh
npm run fixtures:sync:graphthe      # copies *.gtm.json + *.graphthe.json
                                    # into GraphThe's tests/fixtures/
                                    # (destination via --dest or
                                    # GRAPHTHE_REPO; never .curve.json)
```

## Pre-export validation (v1, 08-04)

`exportGraphthe` records what it changed and what GraphThe cannot
simulate; `buildExportReport` (src/interchange/validate.ts) turns those
notes into a warn-but-allow report the Export panel renders. The export
is ALWAYS written.

- **Multi-joints** (3+ links pinned at one point by revolute joints that
  share links and coincide at the reference pose) are exported as a STAR
  of binary edges around one hub at that same point -- kinematically
  equivalent and canonical (a re-imported star re-exports byte-
  identically). Hub = ground (node 0) if it participates, else the
  participant with the most group joints (tie -> lowest exported node
  id). Existing hub-x joints are reused (their `input` carries over);
  missing ones are synthesized at the group point; cycle-closing joints
  are dropped. Every group is reported (participants, hub, kept/
  synthesized/dropped joints). Prismatic joints NEVER take part in
  grouping (a slider's R and P joints coincide at the reference pose by
  design). Coincidence tolerance: `1e-9 * max(1, bounding-box diagonal
of all joint world points)` -- the drawing tools produce bit-identical
  or one-round-trip-off coincident points, so this absorbs float noise
  only.
- **Several fixed bodies** merge into ground node 0 (`link_names` lists
  them); reported as an info item.
- **GraphThe cannot simulate** (error-level, but the export is still
  written): Gruebler DOF != 1 on the EXPORTED (post-split) graph, no
  motor, several motors, a motor not on a ground pivot, a linear/slider
  motor.
- **Warnings**: a parallel joint (second joint between the same two
  nodes) not exported; a dangling joint; a moving node whose exported
  degree is 1 or > 5 (dms's atlas classifier cannot label it).

## Importing into Simuplandes

The import dialog (and `planImport`) read more than the files written by
`exportGraphthe`. Accepted forms:

- **v1** envelopes (`simuplandes-graphthe-export`) and **v0** `.gtm.json`
  fixtures (`simuplandes-parity-fixture`).
- A bare NetworkX **node-link** dict: `nodes` plus `edges` (NetworkX >= 3.6)
  or `links` (older NetworkX). `pos` on each edge is optional.
- Optional per-edge `pos` (joint world point), `type` (`revolute` /
  `prismatic`), `axis`, `input`.
- **Lengths** (layout from link lengths only): per-node `length` or
  `link_length`, or a top-level `link_lengths` object keyed by node id (or an
  array by index).

Without `pos` the importer lays the graph out automatically (seeded, so the
same graph always gives the same drawing). With only lengths, the layout is
fitted to them first.

**Length rule** (GraphThe's `_link_lengths`): a link's length is the maximum
pairwise distance between its joint points. A binary link therefore fixes
its one joint distance exactly; for a link with three or more joints the
farthest pair is pinned to the length and the other pairs may not exceed it.

This is an ASSUMPTION until GraphThe has a JSON writer: the exact key names
for lengths are not produced by any GraphThe code today, so they are
documented here from its in-memory `link_lengths` convention.
