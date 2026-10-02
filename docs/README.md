# Simuplandes Studio — developer docs

These notes explain what was built in **v0.1 of Simuplandes Studio** (Sept–Oct 2026), how the code is organized, and why the main design choices were made. For setup and everyday commands, see the root [`README.md`](../README.md).

## What it is

Simuplandes Studio is a browser-based workbench for planar mechanisms, in the spirit of Working Model 2D. You sketch links, pins, sliders and motors on a canvas, then drive the mechanism through its motion.

It is also the visual front end of **GraphThe**, a Python project that models linkages as graphs: links are nodes and joints are edges. Every mechanism on the canvas is therefore also a GraphThe graph. It can be exported to GraphThe's data and learning pipeline, and a GraphThe graph can be imported, drawn and animated.

**Core value:** the drawing and the graph are two views of one model. Draw a mechanism, export it, import it again, and you get the same mechanism moving the same way, with no loss.

## Starting point

The original Simuplandes v0.1 was an undergraduate thesis app by Juan Esteban Arboleda Restrepo (Uniandes, GPL-3.0). It had these problems:

- It did not build, because it depended on a local `constraint-solver-js` package whose source is lost.
- It used matter.js soft constraints, so pins drifted and there were no prescribed motors.
- It had no save, no undo and no tests.
- It mixed model, rendering and physics in the same classes.

The app was rebuilt in place under `simuplandes/src/`, carrying over ideas rather than code. The old sources are kept, unbuilt, in `simuplandes/src/legacy/` for reference.

## What was delivered

| Area | Result |
|------|--------|
| Foundation | Vite + strict TypeScript + React 18 toolchain. `npm run check` is the single gate: lint, format, typecheck, and unit/browser tests with coverage. Includes a CI workflow. |
| Mechanism document | One plain, Zod-validated, versioned document. Patch-based undo/redo, `.simup.json` save/open, and autosave to localStorage. |
| Kinematic engine | Exact Newton–Raphson position solver with revolute and prismatic joints, rotary and linear motors, velocity and acceleration, lock-up and singularity detection, assembly, and mobility analysis. |
| Studio (Build mode) | Tool rail, CAD-style snapping, dynamic length/angle input, Inspector, Ctrl+K palette, shortcut sheet, Spanish and English, light and dark themes. |
| Simulate mode | Transport bar and scrubber, drag-to-drive, coupler-curve traces, uPlot plots with CSV export, DOF badge. |
| Graph view | Live link graph with shared hover and selection, Gruebler, Baranov and link-assortment checks, and identification against the 6/8-bar atlas. |
| dms (Python) | Rigid-plate geometry mode and prismatic joints, with parity against Simuplandes on 15 shared fixtures. GraphThe was migrated to this mode. |
| Export | GraphThe Mechanism JSON (NetworkX node-link), a pre-export validation report, and SVG/PNG export of the drawing and the graph. |
| Python bridge | `graphthe.io.mechanism_json` in GraphThe, with contract tests on shared golden files. |
| Import | Imports graphs with or without coordinates, with seeded auto-layout, a preview dialog with fixes, an atlas browser and an examples gallery. |

All 52 v1 requirements were met. The last full run was on 2026-09-30:

- `npm run check`: 2638/2638 tests
- Playwright E2E: 74/74
- Fixture generators: `--check` clean
- `npm run build`: OK

## Docs in this folder

| File | Contents |
|------|----------|
| [architecture.md](architecture.md) | Module layout, data flow, enforced import boundaries, document model, stores and undo, persistence, testing |
| [kinematics.md](kinematics.md) | How the solver works: formulation, continuation, lock-up, drag-to-drive, mobility |
| [graphthe-bridge.md](graphthe-bridge.md) | Graph model, the interchange format, export rules, import and auto-layout, the atlas, and the dms and GraphThe changes |
| [design-decisions.md](design-decisions.md) | Decision log: what was chosen, what was rejected, and why |
| [status.md](status.md) | Feature checklist, known limitations, and ideas for v0.2 and v2 |

The full interchange and fixture specification is kept next to the fixtures in [`simuplandes/fixtures/README.md`](../simuplandes/fixtures/README.md).

## Related repositories

The project spans three repositories:

| Repo | Role | What changed |
|------|------|--------------|
| Simuplandes (this repo) | The studio and the owner of the shared fixtures | Rebuilt app; `fixtures/`; sync scripts |
| [dms](https://github.com/JonathanCamargo/dynamics_of_mechanical_systems) (`dynamics_of_mechanical_systems`) | Python kinematics used by GraphThe | `NBarMechanism.from_joint_positions` rigid-plate geometry mode, prismatic joints, public setters, pytest suite with parity tests |
| GraphThe | Graph learning for linkages | Migrated to dms geometry mode through public setters; new `graphthe/io/mechanism_json.py` with contract tests in `tests/test_mechanism_json*.py` |

## Licensing

- Simuplandes stays GPL-3.0, the original author's license. Changing it would need their consent.
- GraphThe and dms are MIT. MIT code can be used inside GPL code, so the bridge is compatible.
