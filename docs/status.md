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

## Unreleased (dynamics, 2026-10-06)

Inverse and forward dynamics, from the v2 backlog. Details are in [dynamics.md](dynamics.md).

- **Schema v2:** link mass properties (custom, or computed from the shape and document densities), gravity, linear and torsional spring-dampers, and a dynamics mode per motor (follow its motion, or apply a torque/force expression in `t`, `q`, `dq`). Loads are now used. v1 files migrate.
- **`src/dynamics/`:** a pure module over the kinematic engine. It does the augmented `[M Jᵀ; J 0]` solve in SI coordinates for forward dynamics, inverse dynamics and velocity projection, gives joint reactions and motor efforts, and integrates with RK4 plus position/velocity projection.
- **Kinematics analysis** now reports the forces the motion needs. Plots gain joint reactions, motor torque/force and power, spring states and energy.
- **Dynamics analysis:** a Kinematics/Dynamics switch on the transport. Dynamics integrates a trajectory in the background (2–60 s), then plays, steps and scrubs over it, and plots it against time. It accepts multi-DOF mechanisms.
- **Editing:** a spring tool (K), torsional springs from the joint form, and Inspector sections for gravity and densities, mass properties, loads and motor dynamics. Springs and loads are drawn on the canvas and in SVG/PNG export.
- **Examples:** a double pendulum and a damped mass-spring, which open in Dynamics.

Gates: `npm run check` passes (2,871 tests, coverage thresholds met, including 95% for `src/dynamics`). The E2E suite passes (78, including a Dynamics spec). `npm run build` is OK.

## Unreleased (interface pass, 2026-10-06)

Interface and usability work after v0.1. `npm run check` (2,677 tests) and the E2E suite (74) pass.

**Layout and navigation**

- The top bar stays on one line from laptop widths down to an embedded studio. The document name, the "Studio" suffix and the mode labels drop out at narrower breakpoints; every control keeps its accessible name.
- The File menu is grouped (file, examples and atlas, share and export) with icons and shortcut hints.
- New shortcuts: Ctrl+S, Ctrl+Shift+S and Ctrl+O (⌘ on macOS).
- Buttons, toggles and tabs use sentence case (theme `typography.button`).
- Status messages are toasts, so they no longer push the canvas down.
- The status bar leads with the next-step hint. The snap status shows only while snapping, and the coordinates hide at narrow widths.
- The transport bar has a filled Play button, a wider scrubber, a compact speed select, and a Plots toggle that shows when it is on.
- The command palette styles its group headings and highlights the keyboard-selected command. New commands: switch to Build or Simulate, show the graph, export an image.

**Canvas**

- Fit to view frames what the canvas shows when it is clicked: in Simulate, the current pose and the coupler-curve traces.
- A mechanism opened straight into Simulate (example, shared link) is framed for its whole motion (`sweepPoses` in `simStore`, `motionBounds` in `canvas/bounds.ts`). A later Build/Simulate toggle never moves the camera.

**Export**

- Drawing and graph images match the canvas (the export dock shares the canvas's view store). Before, they used a fixed 480 × 320 default view.
- The Export tab puts images first (a 2 × 2 grid, PNG first), then the GraphThe JSON with its report.

**New features**

- **Share links.** File > Copy share link packs the whole document into the URL fragment (`#m=…`, deflate + base64url; `persistence/shareLink.ts`). Opening the link loads the mechanism in Simulate. If the current drawing is not empty, the studio asks first. This also works when the link is pasted into a tab that already shows the studio. The fragment never reaches a server.
- **Motion card.** In Simulate, with nothing selected, the Inspector summarizes the motion over the whole sweep: the input range, whether each link turns fully, oscillates (and by how much) or only translates, and the size of each coupler curve (`sim/motionSummary.ts`).

**Smaller fixes**

- The document counts use singular and plural forms ("1 motor").
- The default document name and the four-bar example name are shown in the interface language.
- Example and atlas card subtitles wrap to two lines instead of being cut off.

## Unreleased (phone layout, 2026-10-20)

The studio is usable on a phone and in a browser zoomed far in.

- **Compact layout.** It switches on by itself below 900 px wide or 500 px tall (`ui/shell/useCompactLayout.ts`). Heavy browser zoom shrinks the CSS viewport, so it gets the compact layout too. A Layout preference (Automatic / Desktop / Compact) overrides it. On the desktop bar it is the devices button; in the compact layout it is in the menu. It is persisted as `layoutMode`.
- **In portrait** the tools are a horizontal bar under the canvas, the dock (Inspector / Graph / Export) opens as a sheet under the canvas from the top bar's Panel button, and choosing a dock tab from anywhere (Export image, palette commands) opens the sheet. **In landscape** the rail stays at the left and the sheet opens at the right.
- **Top bar:** the File button becomes a menu icon. The command palette, shortcuts, language, theme, grid, snap and layout move into that menu. The DOF badge shows only its colored icon; its count is in the badge's popover and accessible name. Bar buttons are finger-sized (about 43 px).
- **Transport and status bar:** the transport shows only in Simulate. It puts the playback buttons and a full-width scrubber first, and lets the status caption wrap. The status bar keeps only the hint and the snap status. The plot dock's header wraps and its chart is shorter.
- **Touch on the canvas:** two fingers pinch-zoom about their midpoint and pan. When a second finger lands, the first finger's tool gesture is cancelled (`onGestureCancel`), and a `pointercancel` does the same. A finger picks and snaps within 18 px instead of 8 (`canvas/pickRadius.ts`). The canvas sets `touch-action: none`, so the page never scrolls or zooms under a gesture.
- Large dialogs (import, atlas, examples) are full-screen below 600 px. The shell uses `100dvh`, so a phone's URL bar does not hide the bottom bars. On a phone, "Load example four-bar" frames the mechanism.

Gates: `npm run check` (2,957 tests) passes except four coverage thresholds that already fail on HEAD (`src/tools/*.ts` and `src/tools/react/**`, from the untested Brush/Eraser tools and toolbars). The E2E suite passes (85, including `e2e/mobile-layout.spec.ts`).

## Unreleased (joints anywhere on a link, 2026-10-20)

A revolute joint can go anywhere on a link, not only on a bar's ends or a plate's corners, and the canvas shows where a joint tool can act before the click.

- **Attach anywhere.** Pin, Ground pivot and Bar ends accept an existing site or any point on a moving link's body: along a bar's drawn path, inside a plate, or on its outline (`canvas/attach.ts`). The joint gets a new site on that link. On a bar the site stays off the drawn path, so the bar's shape and mass do not change; in the graph the link simply gains a joint (a binary bar becomes ternary). Ground's body is never a target: a click in empty space still places a lone ground pivot to draw from.
- **Pin in one click** where two links meet: two crossing bars are pinned exactly at their crossing, a bar end lying on another bar is pinned at the end, and coincident sites are joined. A click on a single link still starts the two-click form. A second click that misses every link now says so, instead of doing nothing.
- **Tool-specific snapping.** A new opt-in `"link"` snap candidate (a diamond on the link, "on Bar 2" in the status bar) is on for the joint tools (`ToolMachine.snapKinds`). Pin no longer offers grid or angle snaps, so its ring only appears where a pin can go. Elsewhere, Pin shows a red "no" sign beside the cursor. The hints for Pin and Ground pivot follow the hover ("Click to pin Bar 1 to Bar 2 here", "Nothing to pin here", "Click to pin Bar 1 to ground here", "…place a ground pivot here").
- **Ground pivots nothing uses** (no joint or spring) are drawn faded and dashed until a link is pinned to them.
- A click on a site already pinned to ground (and nothing else) now reports "already pinned to ground" instead of adding a second ground joint.
- The Plate tool's vertices still pin only to existing sites.

**Deleting**

- **Delete / Backspace works with any tool** (`useToolController`): if the active tool does not use the key itself and is not mid-gesture, it deletes the selection. Not in Simulate.
- **A trash button** deletes the selection: in the desktop top bar after Undo/Redo (disabled with nothing selected, hidden in Simulate), and on a phone floating on the canvas under the Fit button while something is selected (the compact top bar has no room).
- **No stray points after a delete** (`deleteEntities`): a site that only existed as an attachment (off a bar's path, or not on a plate's corner) goes when the last joint, spring or load using it is deleted, including through deleting the link on the other side. Ground pivots stay; they are drawn faded once unused and can be deleted on their own.

Gates: `npm run check` (2,991 tests) passes except two coverage thresholds that already failed (`src/tools/*.ts` statements at 94.94% and `src/tools/react/**` functions, from the Brush/Eraser gap above). The E2E suite passes (87, including `e2e/joint-placement.spec.ts` and a phone delete test in `e2e/mobile-layout.spec.ts`). The ESLint-config seam tests got a 30 s timeout: their first, cold ESLint load took more than 5 s in a full parallel run.

## Known limitations and loose ends

### Bugs

- **The production build ships the DEV test hook.** `window.__simuplandesSim` (from `src/sim/react/testHook.ts`) ends up in `dist/`. It should be gated so it is tree-shaken out of production builds.

### UI polish (Phase 9)

- **Auto-layouts can look messy.** They are valid, but plates often overlap and links cross. A layout-quality term (overlap and crossing penalties) would help.
- **Two mismatched angles.** The `layout-applied` note shows the mobility gate's early-exit range (for example 76°), while the verdict chip shows the full range (for example 262°). The degrees should be dropped from the note.
- **Misleading wording.** The verdict chip says "Se mueve, pero solo N°" even for large ranges. "Solo" should appear only below the target.

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

- **Dynamics follow-ups:** contact and friction (an optional matter.js mode), joint limits, time-varying loads, a user-set integration step, and drag-to-drive in Dynamics (a "mouse spring" with live integration). The core dynamics shipped in the unreleased dynamics work above.
- **GraphThe in the loop:** draw a target curve, call a GraphThe inference service, and import ranked candidate mechanisms; overlay the target and generated curves with an error metric; in-browser dimensional optimization.
- **Sharing:** compressed URL sharing, and an embeddable read-only player for course pages.
