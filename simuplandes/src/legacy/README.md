# Legacy (v0.1) sources

This directory holds the original SimuplAndes v0.1 sources: a Create React
App built on `matter-js` and the now-lost `constraint-solver-js` package.
They are kept verbatim as a behavior reference for Phases 2-5 of the
rewrite — nothing here is meant to run again as-is.

## Status

- **Not built.** Excluded from the TypeScript program (`tsconfig.app.json`
  `exclude`).
- **Not type-checked.** Same exclusion as above; these are plain `.js`/`.jsx`
  files anyway.
- **Not bundled.** Excluded from Vite's dev/build graph (`vite.config.ts`
  test globs) and from `optimizeDeps` scanning. As long as nothing under the
  new `src/**` imports from `src/legacy/**`, Vite never touches this code.
- **Not linted or tested.** From plan 01-03 onward, `eslint.config.js` also
  ignores `src/legacy/**`.

**Nothing in the new `src/**` may import from `src/legacy/**`.** Treat this
directory as read-only reference material, not a dependency.

## Why it cannot run

These sources import `constraint-solver-js` (see `logic/utils/ConstraintUtils.js`
and the vector/frame helpers used throughout `logic/` and `components/`),
which was a local sibling package (`file:../../ConstraintSolverJs`) whose
source is confirmed lost. That import can no longer resolve, so this code
cannot execute, build, or type-check — this was also the sole reason
`npm install` failed on a clean checkout before this plan.

The vector/frame math half of `constraint-solver-js` is rebuilt from scratch
as `src/geom` (plan 01-02). The constraint-solver half (`Body`/`World`/
`Solver`/`FixedConstraint`/`RotConstraint`) is intentionally NOT rebuilt
in-place; Phase 3 replaces it with a new Newton-Raphson kinematic solver.

## Edits made to this code

- `index.js`: removed the `serviceWorkerRegistration`/`reportWebVitals`
  imports and calls (plan 01-01) — the CRA files they referenced were
  deleted since they were unmodified PWA boilerplate.
- 01-03: swapped FontAwesome → `@mui/icons-material` in `Editor.jsx`/
  `Player.jsx` and removed the Bootstrap import from `index.js` (Bootstrap
  was only a global CSS reset; no Bootstrap classes were used).
