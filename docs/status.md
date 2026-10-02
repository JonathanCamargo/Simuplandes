# Status (v0.1, 2026-10-01)

## Delivered

The project ran as ten phases, all complete and verified:

| # | Phase | Delivered |
|---|-------|-----------|
| 1 | Rescue and foundation | Vite/TypeScript toolchain, `geom` module at 100% coverage, single UI kit, `npm run check`, CI workflow |
| 2 | Mechanism document | Zod schema, patch-based undo/redo, `.simup.json` save/open, autosave and restore, migrations |
| 3 | Kinematic engine | Revolute/prismatic joints, motors, velocity and acceleration, lock-up, singularity, assembly, mobility; validated against analytic solutions |
| 4 | Studio shell and build tools | Layout, tool rail, snapping, dynamic input, Inspector, palette and shortcuts, es/en, themes |
| 5 | Simulate mode | Transport bar, scrubber, drag-to-drive, traces, plots and CSV, DOF badge |
| 6 | Graph view and structural analysis | Live graph, two-way highlighting, Gruebler/Baranov/assortment checks, atlas identification, three layouts |
| 7 | dms rigid-link geometry and parity | dms geometry mode, 13 revolute parity fixtures, GraphThe migration |
| 7.1 | dms prismatic joints | Sliders and linear input in dms, slider parity fixtures |
| 8 | GraphThe export and Python bridge | Export JSON, validation report, multi-joint star, SVG/PNG export, `graphthe.io.mechanism_json`, contract tests |
| 9 | Graph import, auto-layout and atlas | Tolerant import, preview dialog with fixes, seeded auto-layout, atlas browser, examples gallery |

Last gates (2026-09-30):

- `npm run check`: 2638/2638
- E2E: 74/74
- `gen-curves --check` and `gen-graphthe-exports --check`: clean
- `npm run build`: OK
- dms pytest: 190/190
- GraphThe contract tests: 78 passed

## Known limitations and loose ends

### Bugs

- **The production build ships the DEV test hook.** `window.__simuplandesSim` (from `src/sim/react/testHook.ts`) ends up in `dist/`. It should be gated so it is tree-shaken out of production builds.

### UI polish (Phase 9)

- **Auto-layouts can look messy.** They are valid, but plates often overlap and links cross. A layout-quality term (overlap and crossing penalties) would help.
- **Two mismatched angles.** The `layout-applied` note shows the mobility gate's early-exit range (for example 76°), while the verdict chip shows the full range (for example 262°). The degrees should be dropped from the note.
- **Misleading wording.** The verdict chip says "Se mueve, pero solo N°" even for large ranges. "Solo" should appear only below the target.
- **Truncated Spanish text.** Six-bar atlas card subtitles are cut off.

### Scope gaps

- **No 10-bar atlas.** The atlas has the 18 six- and eight-bar topologies. Exporting the 230 ten-bar chains was optional and skipped. The UI is data-driven, so they can be added later.
- **Prismatic joints in the GNN encoding.** GraphThe's `mechanism_to_pyg` treats prismatic edges as revolute. A prismatic channel is needed when datasets are regenerated.
- **Linear input in dms.** A linear (slider) input works only at the FK/`ComputePoints` level in dms. `GetTrajectory`/`Animate` refuse it.
- **Length key names are unconfirmed.** The importer's names for link lengths are assumed, because GraphThe has no JSON writer yet.

### Process

- **No formal verification report for Phase 8.** Its evidence is in the plan summaries, the contract tests and the user's sign-off.
- **A fragile dms test.** dms's hypothesis property tests are sensitive to new float literals in `nbar.py`, because hypothesis mines constants from the source. Prefer reusing existing literals there.

## Ideas for next versions

**v0.2 (near term):**

- fix the test-hook leak
- the Phase 9 polish items
- the 10-bar atlas

**v2 (from the requirements backlog):**

- **Dynamics:** masses, inertias, gravity, forces, torques, springs and dampers (Lagrange multipliers with stabilization); reaction-force and motor-torque plots; an optional matter.js contact mode.
- **GraphThe in the loop:** draw a target curve, call a GraphThe inference service, and import ranked candidate mechanisms; overlay the target and generated curves with an error metric; in-browser dimensional optimization.
- **Sharing:** compressed URL sharing, and an embeddable read-only player for course pages.
