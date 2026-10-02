# Design decisions

These are the main choices made during v0.1, with the reason for each. Smaller implementation details are documented in the code (TSDoc and comments).

## Product and scope

| Decision | Rationale |
|----------|-----------|
| Rebuild Simuplandes in place, under a new `src/`, carrying over ideas rather than code | Keeps the repo history and the license. The v0.1 classes mixed model, Konva rendering and matter.js, and could not be serialized. |
| Kinematics before dynamics | GraphThe is purely kinematic (coupler curves). Masses, forces and contact come in v2. |
| A custom exact solver instead of matter.js | Mechanisms need exact loop closure, prescribed motors and control over which branch the mechanism follows. matter.js is soft-constraint and drifts. |
| Rewrite `constraint-solver-js` rather than recover it | Its source is lost. The geometry half became `src/geom`, and the solver half became `src/kinematics`. |
| Spanish and English from day one; Spanish is the default | The audience is Uniandes students plus readers of publications. |
| Out of scope: 3D, collaboration, gears/cams/belts, editing on phones, running GNNs in the browser | GraphThe and the target courses are planar lower-pair mechanisms. GraphThe stays in Python. |

## Model and editing

| Decision | Rationale |
|----------|-----------|
| A single plain, Zod-validated document is the source of truth, and everything else is derived and memoized | Gives save, undo and export almost for free, and avoids stale caches. |
| World coordinates are y-up in model units (mm or m); radians internally, degrees in the UI; the y-flip happens only in `worldToScreen` | v0.1 used y-down screen pixels. Converting once, at the edge of the system, removes a whole class of sign bugs. Mirrored Konva nodes are banned by a lint rule. |
| Each link has a reference `pose`, and its sites are link-local | Sites can then be turned into world positions without solving, and it gives Build mode a fixed pose. |
| Hand-rolled undo using Immer `produceWithPatches`; `execute(label, recipe)` is the only mutation path | One Immer pass per command makes multi-object edits a single undo step, and gesture merging is easy. Libraries such as zundo didn't fit that model. |
| One migrate-and-parse entry point for files and autosave | Older or malformed files either migrate or fail with one clear error type. A session that can't be read is backed up rather than lost. |
| Drawing tools are pure state machines, each commit is one `execute()`, and a hint line is required for every tool state | Tools can be unit-tested without a canvas, and the UI always tells the user the next step. |
| Snapping priority: site > midpoint > grid > 15° | Pinning to existing joints is the most common intent. It replaces v0.1's multi-step anchor → pin flow. |

## Solver

| Decision | Rationale |
|----------|-----------|
| One LU core and one LM-damped Newton routine for both continuation and assembly | One code path to validate. It also covers redundant (over-determined but consistent) topologies. |
| Gruebler DOF and Jacobian-rank DOF reported separately | Gruebler is the classroom number. The rank explains what actually moves, for example when a bar is redundant. |
| A branch-preserving predictor–corrector, with lock-up detection and reversal | A rocker must reverse at a toggle position, never jump to another branch. |
| An in-repo expression parser for motor laws | `expr-eval` has unpatched code-execution advisories, and expressions come from user files. |
| Solve on the main thread | Systems with 12 links or fewer solve at well over 60 steps/s. A Worker would only be added if profiling showed a need. |
| Only `src/sim` may import `src/kinematics`, and both stay free of React (lint-enforced) | Keeps the solver pure and testable, and keeps per-frame work out of React. |

## Graph and interchange

| Decision | Rationale |
|----------|-----------|
| Links are nodes, joints are edges, and ground is a single node 0 | Matches GraphThe. Fixed bodies merge into ground on export. |
| Reference-pose joint positions are the geometric truth in the interchange format | Lossless for plates (GraphThe's single `length` is ambiguous for them), and assembled by construction. |
| The interchange format is NetworkX node-link JSON plus a small envelope | Python loads it with no custom code, and one format serves both directions. |
| Byte-identical round trip: fixed key order, sorted ids, no rounding | Golden files can be compared byte for byte, and drift between the repos shows up immediately. |
| Multi-joints export as a canonical star | Keeps the graph simple, as GraphThe requires, while staying kinematically equivalent and stable when re-exported. |
| Export warns but always writes | The user decides. The report says what GraphThe can't simulate and why. |
| A graph panel in plain SVG with custom layouts (spatial, circular, layered) rather than React Flow or a force layout | Graphs have 12 nodes or fewer. A spatial layout that mirrors the drawing reads better than a generic force layout. |
| Atlas identification by a WL invariant plus a backtracking isomorphism check, both written from scratch | Small graphs, no dependency, and correctness under relabeling is proven by tests. |
| Seeded, deterministic auto-layout computed at import time, with a mobility gate | The same graph always gives the same drawing. It handles all 18 atlas topologies in under 2 s, so no precomputed layouts are needed. |
| An import preview in throwaway stores, committed as one undo step | Nothing touches the document until the user confirms, and the import is easy to undo. |

## Cross-repo (dms and GraphThe)

| Decision | Rationale |
|----------|-----------|
| Fix dms (rigid per-link geometry) **before** building the export bridge | Otherwise an exported 6/8/10-bar would be simulated in GraphThe as a different, collinear mechanism. |
| Geometry mode lives in the same `NBarMechanism` class, and length-only mode is frozen bit for bit | Existing GraphThe results stay reproducible, and the API doesn't fork. |
| No random restarts in dms geometry mode; tracking warm-starts from the reference pose | Deterministic results that match Simuplandes sample for sample. |
| Outputs stay in the caller's frame | Normalization belongs to GraphThe, whose curve encoding is already invariant to it. |
| Simuplandes owns the shared fixtures and the reference curves; the other repos get copies by sync script | No repo needs another at test time, and dms needs no Node. |
| Geometry-mode dataset sampling draws joint positions at a reference pose | It matches the interchange data, and plate shapes follow from the positions. This was the user's decision. |
| Prismatic joints in dms were inserted as Phase 7.1, with linear input at the FK level only | Sliders had to export and simulate. A full linear sweep was out of scope by the user's decision. |
| GraphThe uses only dms's public setters | Stops GraphThe from reaching into private dms state, which could silently break. |
