import { describe, it, expect } from "vitest";
import { createViewStore } from "./viewStore";
import { createEmptyDocument } from "../model";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";
import { defaultViewport } from "./viewport";

describe("createViewStore", () => {
  it("starts at defaultViewport for the given size", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    expect(store.getState().viewport).toEqual(defaultViewport(800, 600));
  });

  it("defaults to a 0x0 size when none is given", () => {
    const store = createViewStore();
    expect(store.getState().viewport.widthPx).toBe(0);
    expect(store.getState().viewport.heightPx).toBe(0);
  });

  it("setSize keeps panWorld and zoom, updates width/height", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    store.getState().zoomAtScreen({ x: 400, y: 300 }, 2);
    const before = store.getState().viewport;
    store.getState().setSize(1000, 500);
    const after = store.getState().viewport;
    expect(after.panWorld).toEqual(before.panWorld);
    expect(after.zoom).toBe(before.zoom);
    expect(after.widthPx).toBe(1000);
    expect(after.heightPx).toBe(500);
  });

  it("zoomAtScreen updates the viewport via zoomAt", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    const before = store.getState().viewport.zoom;
    store.getState().zoomAtScreen({ x: 400, y: 300 }, 3);
    expect(store.getState().viewport.zoom).toBeCloseTo(before * 3, 9);
  });

  it("panByScreen updates the viewport via panByScreen", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    const beforePan = store.getState().viewport.panWorld;
    store.getState().panByScreen({ dx: 20, dy: 0 });
    const afterPan = store.getState().viewport.panWorld;
    expect(afterPan.x).not.toBe(beforePan.x);
  });

  it("fitDocument on an empty document resets to defaultViewport for the current size", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    store.getState().zoomAtScreen({ x: 400, y: 300 }, 5);
    store.getState().fitDocument(createEmptyDocument());
    expect(store.getState().viewport).toEqual(defaultViewport(800, 600));
  });

  it("fitDocument on a non-empty document frames its bounds", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    store.getState().fitDocument(fourBarFixtureParsed);
    const v = store.getState().viewport;
    expect(v.panWorld).toEqual({ x: 70, y: 15 });
  });

  it("reset returns to defaultViewport at the current size", () => {
    const store = createViewStore({ widthPx: 800, heightPx: 600 });
    store.getState().setSize(1000, 400);
    store.getState().zoomAtScreen({ x: 400, y: 300 }, 5);
    store.getState().reset();
    expect(store.getState().viewport).toEqual(defaultViewport(1000, 400));
  });
});
