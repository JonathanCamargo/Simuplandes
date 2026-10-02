// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSimTestHook } from "./testHook";
import { createStudioStore } from "../../uiState/studioStore";
import { createSimStore, type SimReadout } from "../simStore";
import type { SimRuntime } from "../runtime";
import type { Id, Pose } from "../../model";

afterEach(() => {
  delete window.__simuplandesSim;
});

function makeFakeRuntime(snapshot: SimRuntime["snapshot"] = () => null): SimRuntime {
  return {
    enter: vi.fn(),
    exit: vi.fn(),
    documentChanged: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    togglePlay: vi.fn(),
    step: vi.fn(),
    reset: vi.fn(),
    setSpeed: vi.fn(),
    setLoop: vi.fn(),
    scrubTo: vi.fn(),
    beginDrag: vi.fn(() => false),
    dragTo: vi.fn(),
    endDrag: vi.fn(),
    getHistoryTable: vi.fn(() => null),
    snapshot,
    dispose: vi.fn(),
  };
}

const readout: SimReadout = {
  input: 1,
  display: 57.3,
  time: 2,
  direction: 1,
  lockUp: null,
  nearSingular: false,
  solver: { status: "ok", residualNorm: 0 },
};

describe("installSimTestHook", () => {
  it("with dev:true, installs window.__simuplandesSim; the returned uninstall deletes it", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    const runtime = makeFakeRuntime();

    const uninstall = installSimTestHook({ studioStore, simStore, runtime }, { dev: true });

    expect(window.__simuplandesSim).toBeDefined();
    uninstall();
    expect(window.__simuplandesSim).toBeUndefined();
  });

  it("with dev:false, installs nothing", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    const runtime = makeFakeRuntime();

    const uninstall = installSimTestHook({ studioStore, simStore, runtime }, { dev: false });

    expect(window.__simuplandesSim).toBeUndefined();
    expect(() => uninstall()).not.toThrow();
  });

  it("defaults `dev` to import.meta.env.DEV (true under vitest)", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    const runtime = makeFakeRuntime();

    installSimTestHook({ studioStore, simStore, runtime });

    expect(window.__simuplandesSim).toBeDefined();
  });

  it("getMode() reads studioStore.mode", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    installSimTestHook({ studioStore, simStore, runtime: makeFakeRuntime() }, { dev: true });

    expect(window.__simuplandesSim!.getMode()).toBe("build");
    studioStore.getState().setMode("simulate");
    expect(window.__simuplandesSim!.getMode()).toBe("simulate");
  });

  it("getStatus() reads simStore.session (null when not simulating)", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    installSimTestHook({ studioStore, simStore, runtime: makeFakeRuntime() }, { dev: true });

    expect(window.__simuplandesSim!.getStatus()).toBeNull();

    simStore.getState().setSession(
      {
        status: "ready",
        reason: null,
        drivingMode: "motor",
        inputKind: "rotary",
        inputJointId: null,
        inputMotorId: null,
        inputLabel: "",
        ignoredMotorCount: 0,
        inputDisplayOffset: 0,
        gruebler: 1,
        rankDof: 1,
        violations: [],
        errorMessage: null,
      },
      null,
    );
    expect(window.__simuplandesSim!.getStatus()?.status).toBe("ready");
  });

  it("getPoses()/getInput() read from runtime.snapshot() when available", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    const poses = new Map<Id, Pose>([["link-1", { position: [1, 2], angle: 0.5 }]]);
    const runtime = makeFakeRuntime(() => ({ input: 0.25, display: 14.3, poses }));

    installSimTestHook({ studioStore, simStore, runtime }, { dev: true });

    expect(window.__simuplandesSim!.getPoses()).toEqual({
      "link-1": { position: [1, 2], angle: 0.5 },
    });
    expect(window.__simuplandesSim!.getInput()).toEqual({ input: 0.25, display: 14.3 });
  });

  it("getPoses() falls back to simStore.poses when runtime.snapshot() is null; getInput() is null then", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    const poses = new Map<Id, Pose>([["link-2", { position: [3, 4], angle: 1 }]]);
    simStore.getState().setPoses(poses);
    const runtime = makeFakeRuntime(() => null);

    installSimTestHook({ studioStore, simStore, runtime }, { dev: true });

    expect(window.__simuplandesSim!.getPoses()).toEqual({
      "link-2": { position: [3, 4], angle: 1 },
    });
    expect(window.__simuplandesSim!.getInput()).toBeNull();
  });

  it("getPoses() is null when both the snapshot and simStore.poses are null", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    installSimTestHook(
      { studioStore, simStore, runtime: makeFakeRuntime(() => null) },
      { dev: true },
    );

    expect(window.__simuplandesSim!.getPoses()).toBeNull();
  });

  it("getTrace(markerId) returns points/closed for a known marker, null for an unknown one", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    simStore.getState().setSweepData({
      traces: [
        {
          markerId: "marker-1",
          label: "M1",
          points: Float64Array.from([0, 0, 1, 1, 2, 0]),
          closed: true,
        },
      ],
      sweepTable: null,
      quantities: [],
    });
    installSimTestHook({ studioStore, simStore, runtime: makeFakeRuntime() }, { dev: true });

    expect(window.__simuplandesSim!.getTrace("marker-1")).toEqual({
      points: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      closed: true,
    });
    expect(window.__simuplandesSim!.getTrace("not-a-marker")).toBeNull();
  });

  it("getReadout() reads simStore.readout", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    installSimTestHook({ studioStore, simStore, runtime: makeFakeRuntime() }, { dev: true });

    expect(window.__simuplandesSim!.getReadout()).toBeNull();
    simStore.getState().setReadout(readout);
    expect(window.__simuplandesSim!.getReadout()).toEqual(readout);
  });

  it("getPlot() reads simStore.plot", () => {
    const studioStore = createStudioStore();
    const simStore = createSimStore();
    installSimTestHook({ studioStore, simStore, runtime: makeFakeRuntime() }, { dev: true });

    expect(window.__simuplandesSim!.getPlot()).toEqual({
      open: false,
      xAxis: "input",
      quantityIds: [],
    });
  });
});
