import { describe, it, expect, vi } from "vitest";
import { createSimStore, SPEED_OPTIONS } from "./simStore";
import type { SimRange, SimSessionSummary } from "./session";
import type { TraceData } from "./traces";
import type { MeasurementTable, QuantityDef } from "./plots";

const TRACE: TraceData = {
  markerId: "marker-1",
  label: "tracer",
  points: new Float64Array([0, 0, 1, 1]),
  closed: false,
};

const QUANTITY: QuantityDef = {
  id: "link:link-1:angle",
  entityKind: "link",
  entityId: "link-1",
  entityLabel: "crank",
  token: "angle",
  unit: "deg",
  linkIndex: 1,
};

const SWEEP_TABLE: MeasurementTable = {
  xKind: "input",
  xUnit: "deg",
  x: new Float64Array([0, 1]),
  quantities: [QUANTITY],
  columns: [new Float64Array([0, 1])],
  length: 2,
};

const SUMMARY: SimSessionSummary = {
  status: "ready",
  reason: null,
  drivingMode: "motor",
  inputKind: "rotary",
  inputJointId: "joint-1",
  inputMotorId: "motor-1",
  inputLabel: "crank",
  ignoredMotorCount: 0,
  inputDisplayOffset: 0,
  gruebler: 1,
  rankDof: 1,
  violations: [],
  errorMessage: null,
};

const RANGE: SimRange = { min: -Math.PI, max: Math.PI, fullRotation: true };

describe("createSimStore defaults", () => {
  it("starts with the documented initial values", () => {
    const store = createSimStore();
    expect(store.getState()).toMatchObject({
      session: null,
      range: null,
      playing: false,
      speed: 1,
      loop: true,
      poses: null,
      readout: null,
      dragging: null,
      plot: { open: false, xAxis: "input", quantityIds: [] },
      traces: [],
      sweepTable: null,
      quantities: [],
      historyVersion: 0,
    });
  });
});

describe("setSpeed", () => {
  it("accepts every member of SPEED_OPTIONS", () => {
    const store = createSimStore();
    for (const speed of SPEED_OPTIONS) {
      store.getState().setSpeed(speed);
      expect(store.getState().speed).toBe(speed);
    }
  });

  it("ignores a value that isn't a member of SPEED_OPTIONS", () => {
    const store = createSimStore();
    store.getState().setSpeed(2);
    store.getState().setSpeed(3);
    expect(store.getState().speed).toBe(2);
    store.getState().setSpeed(0);
    expect(store.getState().speed).toBe(2);
    store.getState().setSpeed(-1);
    expect(store.getState().speed).toBe(2);
  });
});

describe("setSession", () => {
  it("sets both session and range together", () => {
    const store = createSimStore();
    store.getState().setSession(SUMMARY, RANGE);
    expect(store.getState().session).toBe(SUMMARY);
    expect(store.getState().range).toBe(RANGE);
  });

  it("can clear both back to null", () => {
    const store = createSimStore();
    store.getState().setSession(SUMMARY, RANGE);
    store.getState().setSession(null, null);
    expect(store.getState().session).toBeNull();
    expect(store.getState().range).toBeNull();
  });
});

describe("setPoses / setReadout", () => {
  it("setPoses replaces poses with a new identity", () => {
    const store = createSimStore();
    const poses = new Map([["link-1", { position: [1, 2] as [number, number], angle: 0 }]]);
    store.getState().setPoses(poses);
    expect(store.getState().poses).toBe(poses);
    store.getState().setPoses(null);
    expect(store.getState().poses).toBeNull();
  });

  it("setReadout replaces readout", () => {
    const store = createSimStore();
    const readout = {
      input: 1,
      display: 57.3,
      time: 0.5,
      direction: 1 as const,
      lockUp: null,
      nearSingular: false,
      solver: { status: "ok" as const, residualNorm: 1e-10 },
    };
    store.getState().setReadout(readout);
    expect(store.getState().readout).toBe(readout);
  });
});

describe("setPlaying / setLoop / setDragging", () => {
  it("setPlaying updates only playing", () => {
    const store = createSimStore();
    store.getState().setPlaying(true);
    expect(store.getState().playing).toBe(true);
    expect(store.getState().loop).toBe(true);
  });

  it("setLoop updates only loop", () => {
    const store = createSimStore();
    store.getState().setLoop(false);
    expect(store.getState().loop).toBe(false);
    expect(store.getState().playing).toBe(false);
  });

  it("setDragging updates only dragging", () => {
    const store = createSimStore();
    store.getState().setDragging({ linkId: "link-1" });
    expect(store.getState().dragging).toEqual({ linkId: "link-1" });
    store.getState().setDragging(null);
    expect(store.getState().dragging).toBeNull();
  });
});

describe("plot prefs setters", () => {
  it("togglePlotOpen flips plot.open immutably", () => {
    const store = createSimStore();
    const before = store.getState().plot;
    store.getState().togglePlotOpen();
    expect(store.getState().plot.open).toBe(true);
    expect(store.getState().plot).not.toBe(before);
    store.getState().togglePlotOpen();
    expect(store.getState().plot.open).toBe(false);
  });

  it("setPlotOpen sets plot.open directly", () => {
    const store = createSimStore();
    store.getState().setPlotOpen(true);
    expect(store.getState().plot.open).toBe(true);
    store.getState().setPlotOpen(true);
    expect(store.getState().plot.open).toBe(true);
  });

  it("setPlotXAxis updates plot.xAxis immutably, keeping other plot fields", () => {
    const store = createSimStore();
    store.getState().setPlotQuantities(["angle"]);
    const before = store.getState().plot;
    store.getState().setPlotXAxis("time");
    expect(store.getState().plot.xAxis).toBe("time");
    expect(store.getState().plot.quantityIds).toEqual(["angle"]);
    expect(store.getState().plot).not.toBe(before);
  });

  it("setPlotQuantities updates plot.quantityIds immutably", () => {
    const store = createSimStore();
    const before = store.getState().plot;
    store.getState().setPlotQuantities(["angle", "omega"]);
    expect(store.getState().plot.quantityIds).toEqual(["angle", "omega"]);
    expect(store.getState().plot).not.toBe(before);
  });
});

describe("setSweepData / bumpHistoryVersion", () => {
  it("setSweepData sets traces/sweepTable/quantities together", () => {
    const store = createSimStore();
    store
      .getState()
      .setSweepData({ traces: [TRACE], sweepTable: SWEEP_TABLE, quantities: [QUANTITY] });

    const state = store.getState();
    expect(state.traces).toEqual([TRACE]);
    expect(state.sweepTable).toBe(SWEEP_TABLE);
    expect(state.quantities).toEqual([QUANTITY]);
  });

  it("bumpHistoryVersion increments by one each call", () => {
    const store = createSimStore();
    expect(store.getState().historyVersion).toBe(0);
    store.getState().bumpHistoryVersion();
    expect(store.getState().historyVersion).toBe(1);
    store.getState().bumpHistoryVersion();
    expect(store.getState().historyVersion).toBe(2);
  });
});

describe("clear", () => {
  it("resets session/range/playing/poses/readout/dragging/traces/sweepTable/quantities/historyVersion but keeps speed/loop/plot", () => {
    const store = createSimStore();
    const poses = new Map([["link-1", { position: [0, 0] as [number, number], angle: 0 }]]);
    const readout = {
      input: 1,
      display: 1,
      time: 1,
      direction: 1 as const,
      lockUp: null,
      nearSingular: false,
      solver: { status: "ok" as const, residualNorm: 0 },
    };

    store.getState().setSession(SUMMARY, RANGE);
    store.getState().setPlaying(true);
    store.getState().setPoses(poses);
    store.getState().setReadout(readout);
    store.getState().setDragging({ linkId: "link-1" });
    store.getState().setSpeed(4);
    store.getState().setLoop(false);
    store.getState().setPlotOpen(true);
    store.getState().setPlotQuantities(["angle"]);
    store
      .getState()
      .setSweepData({ traces: [TRACE], sweepTable: SWEEP_TABLE, quantities: [QUANTITY] });
    store.getState().bumpHistoryVersion();

    store.getState().clear();

    const state = store.getState();
    expect(state.session).toBeNull();
    expect(state.range).toBeNull();
    expect(state.playing).toBe(false);
    expect(state.poses).toBeNull();
    expect(state.readout).toBeNull();
    expect(state.dragging).toBeNull();
    expect(state.traces).toEqual([]);
    expect(state.sweepTable).toBeNull();
    expect(state.quantities).toEqual([]);
    expect(state.historyVersion).toBe(0);

    // User preferences survive clear().
    expect(state.speed).toBe(4);
    expect(state.loop).toBe(false);
    expect(state.plot).toEqual({ open: true, xAxis: "input", quantityIds: ["angle"] });
  });
});

describe("subscribers fire exactly once per setter call", () => {
  it("for setSpeed", () => {
    const store = createSimStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().setSpeed(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("for setPlaying", () => {
    const store = createSimStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().setPlaying(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("for togglePlotOpen", () => {
    const store = createSimStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().togglePlotOpen();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not fire for an ignored setSpeed call", () => {
    const store = createSimStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().setSpeed(3);
    expect(listener).not.toHaveBeenCalled();
  });
});
