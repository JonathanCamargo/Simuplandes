// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { createPreferencesStore } from "../../uiState/preferences";
import { createViewStore } from "../../canvas/viewStore";
import { indexDocument, siteWorldPosition, type MechanismDocument } from "../../model";
import { distance } from "../../geom";
import { installDomStubs } from "../../test/domStubs";
import { useToolController, type UseToolControllerOptions } from "./useToolController";
import type { CanvasPointerEvent } from "../../canvas/CanvasStage";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function stubT(key: string): string {
  return key;
}

function makeHarness(schedule?: UseToolControllerOptions["schedule"]) {
  const store = createMechanismStore();
  const studio = createStudioStore();
  const preferences = createPreferencesStore();
  const view = createViewStore({ widthPx: 800, heightPx: 600 });
  const options: UseToolControllerOptions = {
    store,
    studio,
    preferences,
    view,
    t: stubT,
    lang: "es",
    ...(schedule ? { schedule } : {}),
  };
  return { store, studio, preferences, view, options };
}

function down(world: { x: number; y: number }, button = 0): CanvasPointerEvent {
  return {
    type: "pointerdown",
    screen: world,
    world,
    snap: { kind: "none", point: world },
    button,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

function move(world: { x: number; y: number }): CanvasPointerEvent {
  return {
    type: "pointermove",
    screen: world,
    world,
    snap: { kind: "none", point: world },
    button: -1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

function up(world: { x: number; y: number }): CanvasPointerEvent {
  return {
    type: "pointerup",
    screen: world,
    world,
    snap: { kind: "none", point: world },
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

describe("useToolController", () => {
  it("activeTool=bar + a pointerdown starts drawing: toolBusy true, hint drawing", () => {
    const { studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    act(() => studio.getState().setActiveTool("bar"));
    const { result } = renderHook(() => useToolController(options));

    act(() => result.current.onPointer(down({ x: 0, y: 0 })));

    expect(studio.getState().toolBusy).toBe(true);
    expect(studio.getState().hint?.key).toBe("tools.bar.hint.drawing");
  });

  it("typing 120 then Enter creates a bar whose site B local is exactly [120, 0]; undo removes it in one step", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    act(() => studio.getState().setActiveTool("bar"));
    const { result } = renderHook(() => useToolController(options));
    act(() => result.current.onPointer(down({ x: 0, y: 0 })));

    for (const key of ["1", "2", "0", "Enter"]) {
      fireEvent.keyDown(window, { key });
    }

    const doc = store.getState().document;
    expect(doc.links).toHaveLength(1);
    expect(doc.links[0].sites[1].local).toEqual([120, 0]);

    expect(store.getState().canUndo).toBe(true);
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().document.links).toHaveLength(0);

    expect(studio.getState().activeTool).toBe("bar");
  });

  it("a keydown targeting an <input> is not forwarded to the tool machine", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    act(() => studio.getState().setActiveTool("bar"));
    const { result } = renderHook(() => useToolController(options));
    act(() => result.current.onPointer(down({ x: 0, y: 0 })));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "1" });
    fireEvent.keyDown(input, { key: "Enter" });
    input.remove();

    expect(store.getState().document.links).toHaveLength(0);
    expect(studio.getState().toolBusy).toBe(true); // still mid-draw
  });

  it("a keydown is not forwarded while the command palette is open", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    act(() => studio.getState().setActiveTool("bar"));
    const { result } = renderHook(() => useToolController(options));
    act(() => result.current.onPointer(down({ x: 0, y: 0 })));

    act(() => studio.getState().openPalette());
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "Enter" });
    act(() => studio.getState().closePalette());

    expect(store.getState().document.links).toHaveLength(0);
  });

  it("changing activeTool mid-draw cancels the previous machine: toolBusy false, no effect", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    act(() => studio.getState().setActiveTool("bar"));
    const { result } = renderHook(() => useToolController(options));
    act(() => result.current.onPointer(down({ x: 0, y: 0 })));
    expect(studio.getState().toolBusy).toBe(true);

    act(() => studio.getState().setActiveTool("select"));

    expect(studio.getState().toolBusy).toBe(false);
    expect(store.getState().document.links).toHaveLength(0);
  });

  it("coalesces pointermoves: 10 moves before one scheduled frame result in one dispatch, using the last position", () => {
    let scheduleCallCount = 0;
    let capturedCallback: (() => void) | null = null;
    const { studio, options } = makeHarness((cb) => {
      scheduleCallCount += 1;
      capturedCallback = cb;
      return 0;
    });
    act(() => studio.getState().setActiveTool("bar"));
    const { result } = renderHook(() => useToolController(options));

    act(() => {
      for (let i = 1; i <= 10; i++) {
        result.current.onPointer(move({ x: i, y: 0 }));
      }
    });
    expect(scheduleCallCount).toBe(1);

    act(() => {
      capturedCallback?.();
    });
    expect(studio.getState().cursorWorld).toEqual({ x: 10, y: 0 });
  });

  it("four-bar by pointer only: 1 ground + 3 bars, 4 R joints, every joint's sites coincide, 5 history entries", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });

    act(() => studio.getState().setActiveTool("groundPivot"));
    const { result } = renderHook(() => useToolController(options));
    act(() => result.current.onPointer(down({ x: 0, y: 0 })));
    act(() => result.current.onPointer(down({ x: 100, y: 0 })));

    act(() => studio.getState().setActiveTool("bar"));
    act(() => result.current.onPointer(down({ x: 0, y: 0 })));
    act(() => result.current.onPointer(down({ x: 20, y: 40 })));
    act(() => result.current.onPointer(down({ x: 110, y: 80 })));
    act(() => result.current.onPointer(down({ x: 100, y: 0 })));
    fireEvent.keyDown(window, { key: "Escape" });

    const doc: MechanismDocument = store.getState().document;
    const groundLinks = doc.links.filter((l) => l.isGround);
    const barLinks = doc.links.filter((l) => !l.isGround);
    expect(groundLinks).toHaveLength(1);
    expect(barLinks).toHaveLength(3);

    const rJoints = doc.joints.filter((j) => j.type === "R");
    expect(rJoints).toHaveLength(4);

    const index = indexDocument(doc);
    for (const joint of rJoints) {
      const a = index.sites.get(joint.siteA);
      const b = index.sites.get(joint.siteB);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a && b) {
        const worldA = siteWorldPosition(a.link, a.site.local);
        const worldB = siteWorldPosition(b.link, b.site.local);
        expect(distance(worldA, worldB)).toBeLessThan(1e-9);
      }
    }

    expect(store.getState().canUndo).toBe(true);
    let undoSteps = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      undoSteps += 1;
    }
    expect(undoSteps).toBe(5);
  });

  it("during a select-tool drag, at most one store.execute happens per scheduled frame", () => {
    let capturedCallback: (() => void) | null = null;
    const { store, studio, options } = makeHarness((cb) => {
      capturedCallback = cb;
      return 0;
    });
    store.getState().addLink({
      name: "Bar",
      shape: { kind: "bar" },
      sites: [{ local: [0, 0] }, { local: [100, 0] }],
    });
    act(() => studio.getState().setActiveTool("select"));
    const { result } = renderHook(() => useToolController(options));

    const executeSpy = vi.spyOn(store.getState(), "execute");

    act(() => result.current.onPointer(down({ x: 50, y: 0 })));
    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.onPointer(move({ x: 50 + i, y: 0 }));
      }
    });
    expect(executeSpy).not.toHaveBeenCalled();

    act(() => {
      capturedCallback?.();
    });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("supplies a fresh gestureSeed on every pointerdown, shared across a drag's moves", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    const link = store.getState().addLink({
      name: "Bar",
      shape: { kind: "bar" },
      sites: [{ local: [0, 0] }, { local: [100, 0] }],
    });
    const afterAddLink = store.getState().document;
    act(() => studio.getState().setActiveTool("select"));
    const { result } = renderHook(() => useToolController(options));

    act(() => result.current.onPointer(down({ x: 50, y: 0 })));
    act(() => result.current.onPointer(move({ x: 60, y: 0 })));
    act(() => result.current.onPointer(move({ x: 70, y: 0 })));
    act(() => result.current.onPointer(up({ x: 70, y: 0 })));

    const moved = store.getState().document.links.find((l) => l.id === link.linkId);
    expect(moved?.pose.position).toEqual([20, 0]);

    // ONE drag -> one history entry (its move effects all shared one gestureId):
    // a single undo restores the state right after `addLink`, not a partial move.
    store.getState().undo();
    expect(store.getState().document).toEqual(afterAddLink);
  });

  it("a joint drag's snap excludes the cluster's own sites (no self-snap)", () => {
    const { store, studio, options } = makeHarness((cb) => {
      cb();
      return 0;
    });
    const ground = store.getState().addLink({
      name: "Ground",
      isGround: true,
      sites: [{ local: [0, 0] }],
    });
    const crank = store.getState().addLink({ name: "Crank", sites: [{ local: [0, 0] }] });
    store.getState().addJoint({ type: "R", siteA: ground.siteIds[0], siteB: crank.siteIds[0] });

    act(() => studio.getState().setActiveTool("select"));
    const { result } = renderHook(() => useToolController(options));

    act(() => result.current.onPointer(down({ x: 0, y: 0 })));
    // A tiny move that would otherwise re-snap onto the joint's OWN
    // (pre-drag) site at (0,0): with exclusion, it must land near (5,0)
    // (grid/none), not snap back to (0,0).
    act(() => result.current.onPointer(move({ x: 5, y: 0.01 })));

    const doc = store.getState().document;
    const movedCrank = doc.links.find((l) => l.id === crank.linkId);
    expect(movedCrank?.sites[0].local[0]).toBeGreaterThan(1);
  });
});
