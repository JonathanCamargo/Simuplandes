// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSimRuntime, type UseSimRuntimeOptions } from "./useSimRuntime";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore } from "../../store";
import { createSimStore } from "../simStore";
import { createSimRuntime, type SimRuntime } from "../runtime";
import { build as buildFourBar } from "../../kinematics/__fixtures__/fourBar";

afterEach(cleanup);

/**
 * A fake `SimRuntime`: every method is a `vi.fn()`, `snapshot()` returns
 * `null` by default. `satisfies` (rather than a `: SimRuntime` return type)
 * keeps each field's inferred plain-function type, so `expect(runtime.enter)`
 * etc. don't trip `@typescript-eslint/unbound-method` (which only fires on
 * the interface's own method-shorthand signatures).
 */
function makeFakeRuntime() {
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
    snapshot: vi.fn(() => null),
    dispose: vi.fn(),
  } satisfies SimRuntime;
}

function makeHarness(runtime: ReturnType<typeof makeFakeRuntime> = makeFakeRuntime()) {
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore();
  const simStore = createSimStore();
  const options: UseSimRuntimeOptions = { studioStore, mechanismStore, simStore, runtime };
  return { studioStore, mechanismStore, simStore, runtime, options };
}

describe("useSimRuntime", () => {
  it("mounted in Build mode: no enter() call", () => {
    const { runtime, options } = makeHarness();
    renderHook(() => useSimRuntime(options));

    expect(runtime.enter).not.toHaveBeenCalled();
  });

  it("setMode('simulate') calls runtime.enter(currentDoc) once, and sets the simulate hint when ready", () => {
    const { studioStore, mechanismStore, simStore, runtime, options } = makeHarness();
    renderHook(() => useSimRuntime(options));

    act(() => {
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
      studioStore.getState().setMode("simulate");
    });

    expect(runtime.enter).toHaveBeenCalledTimes(1);
    expect(runtime.enter).toHaveBeenCalledWith(mechanismStore.getState().document);
    expect(studioStore.getState().hint).toEqual({ key: "sim.hint.simulate" });
  });

  it("setMode('simulate') sets the notDrivable hint when the session status isn't ready", () => {
    const { studioStore, simStore, options } = makeHarness();
    renderHook(() => useSimRuntime(options));

    act(() => {
      simStore.getState().setSession(
        {
          status: "not-drivable",
          reason: "multi-dof",
          drivingMode: "none",
          inputKind: null,
          inputJointId: null,
          inputMotorId: null,
          inputLabel: "",
          ignoredMotorCount: 0,
          inputDisplayOffset: 0,
          gruebler: 0,
          rankDof: 2,
          violations: [],
          errorMessage: null,
        },
        null,
      );
      studioStore.getState().setMode("simulate");
    });

    expect(studioStore.getState().hint).toEqual({ key: "sim.hint.notDrivable" });
  });

  it("a document change while simulating calls runtime.documentChanged(newDoc)", () => {
    const { studioStore, mechanismStore, runtime, options } = makeHarness();
    renderHook(() => useSimRuntime(options));

    act(() => studioStore.getState().setMode("simulate"));
    vi.mocked(runtime.documentChanged).mockClear();

    act(() => {
      mechanismStore.getState().addLink({ name: "Bar", sites: [{ local: [0, 0] }] });
    });

    expect(runtime.documentChanged).toHaveBeenCalledTimes(1);
    expect(runtime.documentChanged).toHaveBeenCalledWith(mechanismStore.getState().document);
  });

  it("a document change while in Build does nothing", () => {
    const { mechanismStore, runtime, options } = makeHarness();
    renderHook(() => useSimRuntime(options));

    act(() => {
      mechanismStore.getState().addLink({ name: "Bar", sites: [{ local: [0, 0] }] });
    });

    expect(runtime.documentChanged).not.toHaveBeenCalled();
  });

  it("setMode('build') calls runtime.exit() and resets the hint to null", () => {
    const { studioStore, runtime, options } = makeHarness();
    renderHook(() => useSimRuntime(options));

    act(() => studioStore.getState().setMode("simulate"));
    act(() => studioStore.getState().setMode("build"));

    expect(runtime.exit).toHaveBeenCalledTimes(1);
    expect(studioStore.getState().hint).toBeNull();
  });

  it("simStore.dragging set publishes a dragging hint with the link's name; cleared reverts to the simulate hint", () => {
    const { studioStore, mechanismStore, simStore, options } = makeHarness();
    const { linkId } = mechanismStore
      .getState()
      .addLink({ name: "Coupler", sites: [{ local: [0, 0] }] });
    renderHook(() => useSimRuntime(options));

    act(() => studioStore.getState().setMode("simulate"));
    act(() => simStore.getState().setDragging({ linkId }));

    expect(studioStore.getState().hint).toEqual({
      key: "sim.hint.dragging",
      values: { link: "Coupler" },
    });

    act(() => simStore.getState().setDragging(null));
    expect(studioStore.getState().hint).toEqual({ key: "sim.hint.simulate" });
  });

  it("dragging is ignored while in Build mode", () => {
    const { mechanismStore, simStore, studioStore, options } = makeHarness();
    const { linkId } = mechanismStore
      .getState()
      .addLink({ name: "Bar", sites: [{ local: [0, 0] }] });
    renderHook(() => useSimRuntime(options));

    act(() => simStore.getState().setDragging({ linkId }));
    expect(studioStore.getState().hint).toBeNull();
  });

  it("unmount calls runtime.dispose() and removes every subscription (no calls after unmount)", () => {
    const { studioStore, mechanismStore, runtime, options } = makeHarness();
    const { unmount } = renderHook(() => useSimRuntime(options));

    act(() => studioStore.getState().setMode("simulate"));
    unmount();

    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    vi.mocked(runtime.enter).mockClear();
    vi.mocked(runtime.documentChanged).mockClear();

    act(() => {
      studioStore.getState().setMode("build");
      studioStore.getState().setMode("simulate");
      mechanismStore.getState().addLink({ name: "Bar", sites: [{ local: [0, 0] }] });
    });

    expect(runtime.enter).not.toHaveBeenCalled();
    expect(runtime.documentChanged).not.toHaveBeenCalled();
  });

  it("survives React StrictMode's mount -> cleanup -> mount: switching to simulate still calls enter and the runtime works", () => {
    const store = createSimStore();
    const scheduler = { queue: new Map<number, (n: number) => void>(), nextId: 1, nowMs: 0 };
    const fakeScheduler = {
      now: () => scheduler.nowMs,
      request: (cb: (n: number) => void) => {
        const id = scheduler.nextId++;
        scheduler.queue.set(id, cb);
        return id;
      },
      cancel: (id: number) => {
        scheduler.queue.delete(id);
      },
    };
    const tick = (ms: number): void => {
      scheduler.nowMs += ms;
      const callbacks = Array.from(scheduler.queue.values());
      scheduler.queue.clear();
      for (const cb of callbacks) cb(scheduler.nowMs);
    };
    const realRuntime = createSimRuntime({ store, scheduler: fakeScheduler });

    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore({ initialDocument: buildFourBar() });
    const options: UseSimRuntimeOptions = {
      studioStore,
      mechanismStore,
      simStore: store,
      runtime: realRuntime,
    };

    renderHook(() => useSimRuntime(options), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });

    act(() => studioStore.getState().setMode("simulate"));
    expect(store.getState().session?.status).toBe("ready");

    act(() => realRuntime.play());
    act(() => tick(16));
    expect(store.getState().playing).toBe(true);
    expect(realRuntime.snapshot()!.input).toBeGreaterThan(0);
  });

  it("never re-renders the component on pose publishes (subscriptions read imperatively)", () => {
    let renderCount = 0;
    function Probe(props: UseSimRuntimeOptions): null {
      renderCount++;
      useSimRuntime(props);
      return null;
    }

    const { simStore, options } = makeHarness();
    render(<Probe {...options} />);
    expect(renderCount).toBe(1);

    act(() => {
      for (let i = 0; i < 10; i++) {
        simStore.getState().setPoses(new Map());
      }
    });

    expect(renderCount).toBe(1);
  });
});
