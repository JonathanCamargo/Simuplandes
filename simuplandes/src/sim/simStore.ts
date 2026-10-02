/**
 * The Phase 5 ephemeral simulate-state store: everything the transport,
 * canvas and (later) plot dock need while `mode === "simulate"`. Non
 * -persisted, vanilla Zustand (mirrors `studioStore.ts`'s style), and has
 * nothing to do with the mechanism document or its undo history -- clearing
 * it never touches `src/store`.
 *
 * Two different render paths read this store, deliberately kept separate:
 * - `poses`: written every rAF frame by plan 05-04's `runtime.ts`. The
 *   canvas reads it IMPERATIVELY (`store.getState().poses`); React
 *   components must NOT `useStore` it, or every frame would re-render React.
 * - `readout`: a throttled (at most ~50ms) numeric snapshot. This is what
 *   React components (the transport bar, the DOF badge, ...) select.
 *
 * Plan 05-04's `runtime.ts` extends this same store with sweep-derived
 * fields (`traces`, `sweepTable`, `quantities`, `historyVersion`), published
 * once per session by `enter()`/`documentChanged()` (never per frame).
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import type { Id, Pose } from "../model";
import type { SimRange, SimSessionSummary } from "./session";
import type { TraceData } from "./traces";
import type { MeasurementTable, QuantityDef } from "./plots";

/** The transport's supported speed multipliers. `setSpeed` ignores any other value. */
export const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4] as const;

export type SpeedMultiplier = (typeof SPEED_OPTIONS)[number];

/** What the per-frame solve reported for the current pose. */
export type SolverReadoutStatus = "ok" | "locked" | "no-convergence" | "invalid-input";

/** A throttled, React-safe snapshot of the simulation's current numeric state. */
export interface SimReadout {
  /** The relative motor input (rad for rotary, length units for linear); 0 is the reference pose. */
  readonly input: number;
  /** `inputDisplayValue(...)`'s result: degrees for rotary, length units for linear. */
  readonly display: number;
  /** Simulated seconds since the transport was last reset. */
  readonly time: number;
  readonly direction: 1 | -1;
  readonly lockUp: { readonly display: number } | null;
  readonly nearSingular: boolean;
  readonly solver: { readonly status: SolverReadoutStatus; readonly residualNorm: number };
}

export type PlotXAxis = "input" | "time";

export interface PlotPrefs {
  readonly open: boolean;
  readonly xAxis: PlotXAxis;
  readonly quantityIds: readonly string[];
}

export interface SimState {
  /** `null` means "not simulating" (Build mode, or no document to simulate). */
  session: SimSessionSummary | null;
  range: SimRange | null;
  playing: boolean;
  speed: SpeedMultiplier;
  loop: boolean;
  /** Per-frame. Read imperatively by the canvas; React components must NOT select this. */
  poses: ReadonlyMap<Id, Pose> | null;
  /** Throttled numeric readout; this is what React components select. */
  readout: SimReadout | null;
  dragging: { readonly linkId: Id } | null;
  plot: PlotPrefs;
  /** Per-marker coupler-curve traces, published once per session (plan 05-04's runtime.ts, SIM-04). */
  traces: readonly TraceData[];
  /** The full-sweep "vs input" measurement table, published once per session. `null` with no motor/sweep. */
  sweepTable: MeasurementTable | null;
  /** Every plottable quantity for the current session's system. `[]` with no compiled system. */
  quantities: readonly QuantityDef[];
  /** Bumped (at most once per readout-throttle interval) whenever the live time-history ring buffer grows. React plot components subscribe to this instead of polling the buffer every frame. */
  historyVersion: number;

  setSession(session: SimSessionSummary | null, range: SimRange | null): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  setLoop(loop: boolean): void;
  setPoses(poses: ReadonlyMap<Id, Pose> | null): void;
  setReadout(readout: SimReadout | null): void;
  setDragging(dragging: { linkId: Id } | null): void;
  togglePlotOpen(): void;
  setPlotOpen(open: boolean): void;
  setPlotXAxis(axis: PlotXAxis): void;
  setPlotQuantities(ids: readonly string[]): void;
  /** Sets `traces`/`sweepTable`/`quantities` together (always published as one atomic sweep-derived batch). */
  setSweepData(data: {
    traces: readonly TraceData[];
    sweepTable: MeasurementTable | null;
    quantities: readonly QuantityDef[];
  }): void;
  /** Increments `historyVersion` by one. */
  bumpHistoryVersion(): void;
  /** Resets `session`, `range`, `playing`, `poses`, `readout`, `dragging`, `traces`, `sweepTable`, `quantities` and `historyVersion`. Keeps `speed`, `loop` and `plot` (user preferences for the session). */
  clear(): void;
}

export type SimStore = StoreApi<SimState>;

const INITIAL_PLOT_PREFS: PlotPrefs = { open: false, xAxis: "input", quantityIds: [] };

function isSpeedMultiplier(value: number): value is SpeedMultiplier {
  return (SPEED_OPTIONS as readonly number[]).includes(value);
}

/** `createSimStore()`: a fresh, in-memory, non-persisted vanilla Zustand store. */
export function createSimStore(): SimStore {
  return createStore<SimState>((set, get) => ({
    session: null,
    range: null,
    playing: false,
    speed: 1,
    loop: true,
    poses: null,
    readout: null,
    dragging: null,
    plot: INITIAL_PLOT_PREFS,
    traces: [],
    sweepTable: null,
    quantities: [],
    historyVersion: 0,

    setSession(session, range) {
      set({ session, range });
    },
    setPlaying(playing) {
      set({ playing });
    },
    setSpeed(speed) {
      if (!isSpeedMultiplier(speed)) return;
      set({ speed });
    },
    setLoop(loop) {
      set({ loop });
    },
    setPoses(poses) {
      set({ poses });
    },
    setReadout(readout) {
      set({ readout });
    },
    setDragging(dragging) {
      set({ dragging });
    },
    togglePlotOpen() {
      set({ plot: { ...get().plot, open: !get().plot.open } });
    },
    setPlotOpen(open) {
      set({ plot: { ...get().plot, open } });
    },
    setPlotXAxis(axis) {
      set({ plot: { ...get().plot, xAxis: axis } });
    },
    setPlotQuantities(ids) {
      set({ plot: { ...get().plot, quantityIds: ids } });
    },
    setSweepData({ traces, sweepTable, quantities }) {
      set({ traces, sweepTable, quantities });
    },
    bumpHistoryVersion() {
      set({ historyVersion: get().historyVersion + 1 });
    },
    clear() {
      set({
        session: null,
        range: null,
        playing: false,
        poses: null,
        readout: null,
        dragging: null,
        traces: [],
        sweepTable: null,
        quantities: [],
        historyVersion: 0,
      });
    },
  }));
}
