/**
 * Real-Konva, real-pointer behavior for `CanvasStage`, run in a headless
 * Chromium browser project (jsdom has no `canvas`/`getContext`, so Konva
 * cannot render there at all -- see `vite.config.ts`'s `browser` project).
 *
 * Renders the real `CanvasArea` (not just `CanvasStage`) inside the same
 * providers `App` uses, so `CanvasArea.tsx` itself is exercised by this
 * suite and counted toward the `src/ui/**\/*.tsx` coverage threshold.
 *
 * Pointer/wheel are dispatched as native `PointerEvent`/`WheelEvent` on
 * Konva's own container div (`.konvajs-content`), not via `userEvent`:
 * Konva only emits its `pointerdown`/`pointermove`/`pointerup` family (what
 * `CanvasStage` listens for) in response to native Pointer Events with
 * `clientX`/`clientY`, and `userEvent`'s hover/click helpers don't expose
 * an arbitrary-element-relative position precise enough for snap-radius
 * assertions.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import Konva from "konva";
import { createStudioTheme } from "../ui/theme/studioTheme";
import { createI18n } from "../i18n/i18n";
import { createPreferencesStore } from "../uiState/preferences";
import { createStudioStore } from "../uiState/studioStore";
import { createMechanismStore } from "../store/mechanismStore";
import { buildExampleFourBar } from "../store/examples";
import { CanvasArea, ViewStoreContext, useViewStore } from "../ui/shell/CanvasArea";
import { CanvasStage } from "./CanvasStage";
import { createViewStore, type ViewStore } from "./viewStore";
import { worldToScreen, screenToWorld, type Viewport } from "./viewport";
import { gridSpacingFor } from "./grid";
import type { Vec2 } from "../geom";
import { siteWorldPosition, type Id, type Pose } from "../model";
import { installCanvasTestHook } from "./layers/canvasTestHook";

afterEach(cleanup);

function renderCanvasArea(view: ViewStore) {
  const store = createMechanismStore();
  buildExampleFourBar(store);
  const studio = createStudioStore();
  const preferences = createPreferencesStore({ storage: null });
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");

  const utils = render(
    <div style={{ width: 800, height: 600 }}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <CanvasArea store={store} studio={studio} preferences={preferences} view={view} />
        </ThemeProvider>
      </I18nextProvider>
    </div>,
  );
  return { ...utils, store, studio, preferences };
}

async function waitForStage(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector(".konvajs-content")).toBeTruthy();
  });
  return container.querySelector(".konvajs-content") as HTMLElement;
}

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointerleave",
  screen: Vec2,
  init: Partial<PointerEventInit> = {},
): void {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: rect.left + screen.x,
      clientY: rect.top + screen.y,
      ...init,
    }),
  );
}

function dispatchWheel(target: Element, screen: Vec2, deltaY: number): void {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + screen.x,
      clientY: rect.top + screen.y,
      deltaY,
    }),
  );
}

/** Waits one animation frame -- `CanvasStage` throttles its store publish to one per frame. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Renders `CanvasStage` directly (not `CanvasArea`), mirroring
 * `SimLayers.chromium.test.tsx`'s pattern -- needed for hover/issue/
 * selection halo tests, which pass `issueLinkIds` and read `studio`'s
 * `hoveredId` directly (props `CanvasArea` does not forward, 06-05's job).
 */
/** A minimal, synchronous `PosesSource` test double (mirrors `SimLayers.chromium.test.tsx`'s). */
function createFakePosesSource() {
  let current: ReadonlyMap<Id, Pose> | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(map: ReadonlyMap<Id, Pose> | null) {
      current = map;
      for (const listener of listeners) listener();
    },
  };
}

function renderCanvasStage(
  view: ViewStore,
  extra: {
    issueLinkIds?: ReadonlySet<Id>;
    posesSource?: ReturnType<typeof createFakePosesSource>;
  } = {},
) {
  const store = createMechanismStore();
  const ids = buildExampleFourBar(store);
  const studio = createStudioStore();
  const preferences = createPreferencesStore({ storage: null });
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");

  const utils = render(
    <div style={{ width: 800, height: 600 }}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <CanvasStage
            store={store}
            studio={studio}
            preferences={preferences}
            view={view}
            width={800}
            height={600}
            issueLinkIds={extra.issueLinkIds}
            posesSource={extra.posesSource}
          />
        </ThemeProvider>
      </I18nextProvider>
    </div>,
  );
  return { ...utils, store, studio, preferences, ids, doc: store.getState().document };
}

/** The most-recently-mounted real Konva stage (see `Konva.stages`). */
function latestKonvaStage(): Konva.Stage {
  const stage = Konva.stages[Konva.stages.length - 1];
  if (!stage) throw new Error("no Konva stage mounted");
  return stage;
}

function findById<T extends Konva.Node>(stage: Konva.Stage, id: string): T | undefined {
  return stage.findOne<T>((n: Konva.Node) => n.id() === id);
}

describe("useViewStore / ViewStoreContext", () => {
  function Consumer(): null {
    useViewStore();
    return null;
  }

  it("throws outside a CanvasArea/ViewStoreContext provider", () => {
    expect(() => render(<Consumer />)).toThrow(/useViewStore must be used within a CanvasArea/);
  });

  it("returns the provided view store inside the provider", () => {
    const view = createViewStore({ widthPx: 100, heightPx: 100 });
    let captured: ViewStore | null = null;
    function Capture(): null {
      captured = useViewStore();
      return null;
    }
    render(
      <ViewStoreContext.Provider value={view}>
        <Capture />
      </ViewStoreContext.Provider>,
    );
    expect(captured).toBe(view);
  });
});

describe("CanvasStage (chromium, real Konva)", () => {
  it("moving the pointer onto a site sets cursorWorld and snapStatus.kind 'site'", async () => {
    const view = createViewStore();
    const { container, studio } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);

    const viewport: Viewport = view.getState().viewport;
    const o4World: Vec2 = { x: 100, y: 0 }; // ground link's second site, per buildExampleFourBar
    const screen = worldToScreen(viewport, o4World);

    dispatchPointer(stageEl, "pointermove", screen);
    await nextFrame();
    await nextFrame();

    await waitFor(() => {
      const cursor = studio.getState().cursorWorld;
      expect(cursor).not.toBeNull();
      const dist = Math.hypot(cursor!.x - o4World.x, cursor!.y - o4World.y);
      expect(dist).toBeLessThanOrEqual(0.5 / viewport.zoom);
      expect(studio.getState().snapStatus?.kind).toBe("site");
    });
  });

  it("a pointer far from every site, at an exact grid point, sets snapStatus.kind 'grid'", async () => {
    const view = createViewStore();
    const { container, studio } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);

    const viewport: Viewport = view.getState().viewport;
    // Bottom-right corner of the 800x600 stage: far from the four-bar
    // (whose sites/midpoints all sit within roughly [0,110]x[0,80]).
    const roughScreen: Vec2 = { x: 760, y: 560 };
    const roughWorld = screenToWorld(viewport, roughScreen);
    const spacing = gridSpacingFor(viewport.zoom);
    const griddedWorld: Vec2 = {
      x: spacing * Math.round(roughWorld.x / spacing),
      y: spacing * Math.round(roughWorld.y / spacing),
    };
    const screen = worldToScreen(viewport, griddedWorld);

    dispatchPointer(stageEl, "pointermove", screen);
    await nextFrame();
    await nextFrame();

    await waitFor(() => {
      expect(studio.getState().snapStatus?.kind).toBe("grid");
    });
  });

  it("a wheel event zooms in and keeps the world point under the cursor fixed", async () => {
    const view = createViewStore();
    const { container } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);

    const before = view.getState().viewport;
    const screen: Vec2 = { x: 300, y: 250 };
    const worldBefore = screenToWorld(before, screen);

    dispatchWheel(stageEl, screen, -120); // deltaY < 0 -> zoom in

    await waitFor(() => {
      expect(view.getState().viewport.zoom).toBeGreaterThan(before.zoom);
    });

    const after = view.getState().viewport;
    const worldAfter = screenToWorld(after, screen);
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
  });

  it("pressing 'f' fits the four-bar so every site is inside the stage", async () => {
    const view = createViewStore();
    const { container, store } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);

    // Zoom away from the fitted view first.
    const fittedZoom = view.getState().viewport.zoom;
    dispatchWheel(stageEl, { x: 400, y: 300 }, -1200);
    await waitFor(() => {
      expect(view.getState().viewport.zoom).not.toBe(fittedZoom);
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true }));

    await waitFor(() => {
      const viewport = view.getState().viewport;
      const doc = store.getState().document;
      for (const link of doc.links) {
        for (const site of link.sites) {
          const world = siteWorldPosition(link, site.local);
          const screen = worldToScreen(viewport, world);
          expect(screen.x).toBeGreaterThanOrEqual(0);
          expect(screen.x).toBeLessThanOrEqual(viewport.widthPx);
          expect(screen.y).toBeGreaterThanOrEqual(0);
          expect(screen.y).toBeLessThanOrEqual(viewport.heightPx);
        }
      }
    });
  });

  it("clicking the Fit button re-fits the four-bar after zooming away", async () => {
    const view = createViewStore();
    const { container } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);

    const fittedZoom = view.getState().viewport.zoom;
    dispatchWheel(stageEl, { x: 400, y: 300 }, -1200);
    await waitFor(() => {
      expect(view.getState().viewport.zoom).not.toBe(fittedZoom);
    });

    const fitButton = container.querySelector('button[aria-label="Ajustar a la vista"]')!;
    fitButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(view.getState().viewport.zoom).toBeCloseTo(fittedZoom, 6);
    });
  });

  it("re-fits automatically when the mechanism store loads a brand-new document", async () => {
    const view = createViewStore();
    const { store } = renderCanvasArea(view);
    await waitFor(() => {
      expect(view.getState().viewport.panWorld.x).not.toBe(100); // already fitted to the four-bar
    });

    const fourBarPan = view.getState().viewport.panWorld;
    store.getState().newDocument({ name: "brand-new" });
    store.getState().addLink({ name: "solo", sites: [{ local: [500, 500] }] });
    // `addLink` is itself undoable (canUndo becomes true), so it must NOT
    // re-trigger a fit -- only the identity-changing `newDocument` call does,
    // and it does so against the (still-empty-at-that-instant) new document.
    await waitFor(() => {
      expect(view.getState().viewport.panWorld).not.toEqual(fourBarPan);
    });
  });

  it("creates its own view store when none is passed", async () => {
    const store = createMechanismStore();
    buildExampleFourBar(store);
    const studio = createStudioStore();
    const preferences = createPreferencesStore({ storage: null });
    const i18n = createI18n("es");
    const theme = createStudioTheme("light", "es");

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <CanvasArea store={store} studio={studio} preferences={preferences} />
          </ThemeProvider>
        </I18nextProvider>
      </div>,
    );

    await waitForStage(container);
    const el = container.querySelector('[data-testid="canvas-area"]')!;
    await waitFor(() => {
      expect(el.getAttribute("data-viewport")).toBeTruthy();
    });
  });

  it("exposes data-viewport on the canvas container, matching the view store", async () => {
    const view = createViewStore();
    const { container } = renderCanvasArea(view);
    await waitForStage(container);

    await waitFor(() => {
      const el = container.querySelector('[data-testid="canvas-area"]');
      expect(el).toBeTruthy();
      const attr = el!.getAttribute("data-viewport");
      expect(attr).toBeTruthy();
      const parsed = JSON.parse(attr!) as Viewport;
      expect(parsed).toEqual(view.getState().viewport);
    });
  });
});

describe("CanvasStage (chromium): hover/issue/selection halos + DEV test hook (GRF-02/GRF-03)", () => {
  it("moving the pointer onto the crank's midpoint sets hoveredId and stamps is-hovered on its link group", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, studio, ids } = renderCanvasStage(view);
    const stageEl = await waitForStage(container);

    const viewport = view.getState().viewport;
    const crankMidWorld: Vec2 = { x: 10, y: 10 * Math.sqrt(3) };
    const screen = worldToScreen(viewport, crankMidWorld);

    dispatchPointer(stageEl, "pointermove", screen);
    await nextFrame();
    await nextFrame();

    await waitFor(() => {
      expect(studio.getState().hoveredId).toBe(ids.crankId);
    });

    const stage = latestKonvaStage();
    const crankGroup = findById<Konva.Group>(stage, `link:${ids.crankId}`)!;
    expect(crankGroup.hasName("is-hovered")).toBe(true);
  });

  it("moving the pointer onto joint A's pin sets hoveredId to the joint id and stamps the pin node", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, studio, doc } = renderCanvasStage(view);
    const stageEl = await waitForStage(container);

    const jointA = doc.joints.find((j) => j.name === "A")!;
    const viewport = view.getState().viewport;
    const aWorld: Vec2 = { x: 20, y: 20 * Math.sqrt(3) };
    const screen = worldToScreen(viewport, aWorld);

    dispatchPointer(stageEl, "pointermove", screen);
    await nextFrame();
    await nextFrame();

    await waitFor(() => {
      expect(studio.getState().hoveredId).toBe(jointA.id);
    });

    const stage = latestKonvaStage();
    const pin = findById<Konva.Circle>(stage, `pin:${jointA.id}`)!;
    expect(pin.hasName("is-hovered")).toBe(true);
  });

  it("pointer over empty space clears hoveredId, and leaving the stage also clears it", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, studio, ids } = renderCanvasStage(view);
    const stageEl = await waitForStage(container);

    const viewport = view.getState().viewport;
    const crankMidWorld: Vec2 = { x: 10, y: 10 * Math.sqrt(3) };
    dispatchPointer(stageEl, "pointermove", worldToScreen(viewport, crankMidWorld));
    await nextFrame();
    await nextFrame();
    await waitFor(() => {
      expect(studio.getState().hoveredId).toBe(ids.crankId);
    });

    const emptyWorld: Vec2 = { x: 900, y: 900 };
    dispatchPointer(stageEl, "pointermove", worldToScreen(viewport, emptyWorld));
    await nextFrame();
    await nextFrame();
    await waitFor(() => {
      expect(studio.getState().hoveredId).toBeNull();
    });

    dispatchPointer(stageEl, "pointermove", worldToScreen(viewport, crankMidWorld));
    await nextFrame();
    await nextFrame();
    await waitFor(() => {
      expect(studio.getState().hoveredId).toBe(ids.crankId);
    });

    dispatchPointer(stageEl, "pointerleave", { x: 0, y: 0 });
    await waitFor(() => {
      expect(studio.getState().hoveredId).toBeNull();
    });
  });

  it("setting hoveredId programmatically (as the graph panel will do) halos the rocker's group with a hover Line child", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, studio, ids } = renderCanvasStage(view);
    await waitForStage(container);

    studio.getState().setHoveredId(ids.rockerId);

    await waitFor(() => {
      const stage = latestKonvaStage();
      const rockerGroup = findById<Konva.Group>(stage, `link:${ids.rockerId}`)!;
      expect(rockerGroup.hasName("is-hovered")).toBe(true);
      const hoverLine = rockerGroup.getChildren((n) => n instanceof Konva.Line && n.opacity() < 1);
      expect(hoverLine.length).toBeGreaterThan(0);
    });
  });

  it("issueLinkIds flags the coupler group with is-issue and an outline child; removing the prop clears it", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, rerender, ids, store, studio, preferences } = renderCanvasStage(view, {
      issueLinkIds: new Set(),
    });
    await waitForStage(container);

    const withIssue = new Set([ids.couplerId]);
    rerender(
      <div style={{ width: 800, height: 600 }}>
        <I18nextProvider i18n={createI18n("es")}>
          <ThemeProvider theme={createStudioTheme("light", "es")}>
            <CssBaseline />
            <CanvasStage
              store={store}
              studio={studio}
              preferences={preferences}
              view={view}
              width={800}
              height={600}
              issueLinkIds={withIssue}
            />
          </ThemeProvider>
        </I18nextProvider>
      </div>,
    );

    await waitFor(() => {
      const stage = latestKonvaStage();
      const couplerGroup = findById<Konva.Group>(stage, `link:${ids.couplerId}`)!;
      expect(couplerGroup.hasName("is-issue")).toBe(true);
      const dashed = couplerGroup.getChildren(
        (n) => n instanceof Konva.Line && (n.dash()?.length ?? 0) > 0,
      );
      expect(dashed.length).toBeGreaterThan(0);
    });

    rerender(
      <div style={{ width: 800, height: 600 }}>
        <I18nextProvider i18n={createI18n("es")}>
          <ThemeProvider theme={createStudioTheme("light", "es")}>
            <CssBaseline />
            <CanvasStage
              store={store}
              studio={studio}
              preferences={preferences}
              view={view}
              width={800}
              height={600}
            />
          </ThemeProvider>
        </I18nextProvider>
      </div>,
    );

    await waitFor(() => {
      const stage = latestKonvaStage();
      const couplerGroup = findById<Konva.Group>(stage, `link:${ids.couplerId}`)!;
      expect(couplerGroup.hasName("is-issue")).toBe(false);
    });
  });

  it("selecting a joint marks its pin is-selected", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, store, doc } = renderCanvasStage(view);
    await waitForStage(container);

    const jointA = doc.joints.find((j) => j.name === "A")!;
    store.getState().select([jointA.id]);

    await waitFor(() => {
      const stage = latestKonvaStage();
      const pin = findById<Konva.Circle>(stage, `pin:${jointA.id}`)!;
      expect(pin.hasName("is-selected")).toBe(true);
    });
  });

  it("the hovered link's halo follows posed geometry once a posesSource emits", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const posesSource = createFakePosesSource();
    const { container, studio, ids, doc } = renderCanvasStage(view, { posesSource });
    await waitForStage(container);

    studio.getState().setHoveredId(ids.crankId);
    await waitFor(() => {
      const stage = latestKonvaStage();
      const crankGroup = findById<Konva.Group>(stage, `link:${ids.crankId}`)!;
      expect(crankGroup.hasName("is-hovered")).toBe(true);
    });

    const crankLink = doc.links.find((l) => l.id === ids.crankId)!;
    const posedPose = { position: crankLink.pose.position, angle: crankLink.pose.angle + 0.3 };
    const posedMap = new Map([[ids.crankId, posedPose]]);
    posesSource.emit(posedMap);

    await waitFor(() => {
      const viewport = view.getState().viewport;
      const stage = latestKonvaStage();
      const crankGroup = findById<Konva.Group>(stage, `link:${ids.crankId}`)!;
      const lines = crankGroup.getChildren((n) => n instanceof Konva.Line) as Konva.Line[];
      const posedSiteWorld = siteWorldPosition({ pose: posedPose }, crankLink.sites[1].local);
      const posedSiteScreen = worldToScreen(viewport, posedSiteWorld);
      for (const line of lines) {
        const pts = line.points();
        expect(pts[pts.length - 2]).toBeCloseTo(posedSiteScreen.x, 5);
        expect(pts[pts.length - 1]).toBeCloseTo(posedSiteScreen.y, 5);
      }
    });
  });
});

describe("installCanvasTestHook (GRF-02/GRF-03 DEV-only E2E surface)", () => {
  afterEach(() => {
    delete window.__simuplandesCanvas;
  });

  it("exposes window.__simuplandesCanvas.haloState reading a live CanvasStage's halo names", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, ids, studio } = renderCanvasStage(view);
    await waitForStage(container);

    studio.getState().setHoveredId(ids.crankId);

    await waitFor(() => {
      const state = window.__simuplandesCanvas?.haloState(ids.crankId);
      expect(state).toEqual({ selected: false, hovered: true, issue: false });
    });

    expect(window.__simuplandesCanvas?.haloState("no-such-id")).toBeNull();
  });

  it("dev=false installs nothing, and the returned cleanup deletes the global", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const stage = new Konva.Stage({ container, width: 10, height: 10 });

    const cleanupNoop = installCanvasTestHook(() => stage, false);
    expect(window.__simuplandesCanvas).toBeUndefined();
    cleanupNoop();

    const uninstall = installCanvasTestHook(() => stage, true);
    expect(window.__simuplandesCanvas).toBeDefined();
    uninstall();
    expect(window.__simuplandesCanvas).toBeUndefined();

    stage.destroy();
    container.remove();
  });
});
