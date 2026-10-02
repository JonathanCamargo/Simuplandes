# Architecture

All app code lives in `simuplandes/`.

## Stack

| Concern | Choice |
|---------|--------|
| Build | Vite 8, TypeScript 6 (strict), React 18. Create React App was dropped because it is deprecated. |
| Canvas | `react-konva` and Konva, kept from v0.1 |
| UI kit | MUI v5 with Emotion. Bootstrap and FontAwesome were removed so there is a single UI kit. |
| State | Zustand (vanilla stores) and Immer patches |
| Validation | Zod 4. The schema is the source of truth for the document's TypeScript types. |
| File I/O | `browser-fs-access` |
| Plots | uPlot |
| i18n | i18next and react-i18next. Spanish is the default; English is available. |
| Tests | Vitest (jsdom plus a Chromium browser project), Playwright E2E, `@vitest/coverage-v8` |

## Module map (`simuplandes/src/`)

```
geom/          Vec2 ops and local↔world frames. Radians, CCW positive, y-up.
               Replaces the vector half of the lost constraint-solver-js.
model/         Zod MechanismDocument schema, ids, units, migrations.
store/         Mechanism store: one execute() path, patch-based undo/redo,
               a command library, selection.
persistence/   .simup.json save/open, autosave and restore through localStorage.
kinematics/    Pure solver: constraints, LU and damped Newton, velocity and
               acceleration, assembly, mobility, singularity, drag IK.
sim/           Simulation orchestration: session, runtime (play/scrub/drag),
               sweeps, traces, plots, CSV, DOF, auto-layout and mobility range.
  sim/react/   React glue for sim: hooks, controllers, DEV-only test hook.
canvas/        Viewport transform, grid, snapping, hit-testing, render model,
               Konva layers.
tools/         Drawing tools as pure state machines: bar, plate, ground pivot,
               pin, slider, motor, marker, select.
graph/         Link graph from the document, Gruebler, Baranov, assortment,
               canonical form, isomorphism, atlas identification, layouts.
interchange/   GraphThe export/import, validation report, multi-joint split,
               tolerant reader, import planning, layout seeds.
examples/      Examples registry built from the measured fixtures.
uiState/       UI preferences and the studio store (mode, dialogs, hover, layout).
               Kept out of the document and out of undo.
ui/            Shell, inspector, graph panel, export panel, import dialog,
               atlas, gallery, plots, palette, theme.
i18n/          Locales (es/en) and number formatting.
legacy/        v0.1 sources, kept for reference only. Not built or linted.
```

Other top-level folders in `simuplandes/`:

- **`fixtures/`:** golden files shared with dms and GraphThe. See [graphthe-bridge.md](graphthe-bridge.md).
- **`scripts/`:**
  - curve and export generators: `gen-curves.ts`, `gen-graphthe-exports.ts`
  - fixture sync to the other repos: `sync-dms-fixtures.mjs`, `sync-graphthe-fixtures.mjs`
  - the offline atlas export from dms: `export-atlas.py`
  - the dev-server smoke test: `smoke-dev.mjs`
- **`e2e/`:** Playwright specs, one or more per success criterion.

## Data flow

```
                 ┌──────────── undo/redo (Immer patches)
                 ▼
user ─► tools ─► store.execute(label, recipe) ─► MechanismDocument (plain data)
                                                    │
         ┌──────────────────────────────────────────┼──────────────────────────┐
         ▼                                          ▼                          ▼
  sim session (derived solver system)        graph analysis (memoized)    export / persistence
         │ poses per frame                          │
         ▼                                          ▼
  canvas (imperative Konva updates)          graph panel, checks, canvas halos
```

- **Nothing derived is stored.** The solver system, the link graph and the analyses are recomputed from the document. They are memoized by document version.
- **Build shows the reference pose.** Simulate never changes the document; posed geometry lives in `simStore` and is fed to the canvas through a plain-data `PosesSource` contract.
- **Per-frame state stays out of React.** The sim runtime keeps hot state (solved state, time, direction, drag target) in a closure. Only poses and throttled readouts go to the store, and the canvas updates imperatively, so React does not re-render every frame.

## Enforced boundaries

Import boundaries are ESLint rules (`eslint.config.js`), so `npm run check` fails if one is broken:

| Rule | Effect |
|------|--------|
| `src/kinematics/**` is pure | No React, Zustand, Immer, Konva, MUI or matter.js, and no browser globals. It may import only `geom` and `model`. |
| Kinematics seam | Only `src/sim/**` may import `src/kinematics`. UI, canvas and tools get poses and readouts from `sim`. |
| Pure logic globs | `tools/*.ts`, `canvas/*.ts`, `uiState/*.ts`, `graph/**`, `interchange/**` may not import React, Konva, MUI or kinematics. |
| `src/sim/*.ts` | Pure orchestration. React glue goes in `src/sim/react/`. |
| No mirrored Konva nodes | A negative `scaleX`/`scaleY` is forbidden. The y-flip happens once, in `canvas/viewport.ts` (`worldToScreen`). |

The interchange code reaches the solver (for import verification and auto-layout) through dependencies injected from `src/sim/importDeps.ts`. This keeps `interchange/` pure.

## Mechanism document (`src/model/schema.ts`)

The document is a single Zod schema (`CURRENT_SCHEMA_VERSION = 1`) and contains:

- **Links:** each has a `pose` (reference/build pose), a `shape` (`bar` or `plate`), `sites` (joint attachment points in link-local coordinates), an `isGround` flag, a name and a color.
- **Joints:** a discriminated union of `revolute` and `prismatic` (the latter with a link-local `axis`), connecting sites on two links.
- **Motors:** rotary or linear, driven by the scrubber or by time (a constant, or an expression in `t`).
- **Markers** (trace points) and **loads** (stored for v2 dynamics).
- **Units:** `mm` (default) or `m`. Angles are radians internally and degrees in the UI.

Coordinates are world y-up in model units. A `superRefine` checks referential integrity.

`migrateDocument`/`parseDocumentJson` is the only way a document is loaded, for both file open and localStorage restore. It throws a single `DocumentLoadError` with a specific reason and readable messages.

## Stores and undo

- **The mechanism store** (`store/mechanismStore.ts`) is a vanilla Zustand store. Every mutation goes through `execute(label, recipe)`, which runs one Immer `produceWithPatches`. A multi-object edit is therefore one undo step.
- **Undo and redo** apply inverse and forward patches, with a 500-step limit. Rapid edits within one gesture (a joint drag, typing in a field) are merged into a single undo step.
- **Selection** lives outside the undo history.
- **Other UI state** lives in separate stores and never enters undo: `studioStore` (mode, dialogs, hover, graph layout), `preferences` (language, theme, dock size) and `simStore` (poses, readouts).

## Testing

| Layer | Tool | Notes |
|-------|------|-------|
| Pure logic | Vitest (`--project unit`) | Per-module coverage thresholds. `geom` is at 100%. |
| Browser rendering | Vitest Chromium project | Konva and image export in real Chromium. The port is pinned to 51730 to avoid a Windows port-exclusion collision. |
| End to end | Playwright (`npm run e2e`, `E2E_PORT=<port>`) | One or more specs per roadmap success criterion, plus screenshots. Specs that open or save files must remove `showSaveFilePicker` and `showOpenFilePicker` (see `disableNativeFilePickers` in `e2e/helpers.ts`). |
| Cross-repo | dms pytest and GraphThe pytest | Parity and contract tests on the synced fixtures. |

Tips:

- To run a quick subset of tests, use `npx vitest run <paths> --project unit --coverage.enabled=false`. A subset run under `npm run test` fails the whole-suite coverage thresholds.
- Tests that run a real simulation or an auto-layout need explicit 30–60 s timeouts under full-suite coverage load.
