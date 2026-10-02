/**
 * Real-Konva coverage (headless Chromium, see `vite.config.ts`'s `browser`
 * project) for the Phase 5 posed-rendering seam: `CanvasStage`'s
 * `posesSource`/`traces` props, `applyRenderModelToLayers`, and
 * `TracesLayer`, mounted together exactly as `CanvasStage.chromium.test.tsx`
 * mounts the Build-mode stage.
 *
 * A fake `PosesSource` (`emit(map)`) stands in for the real simulation
 * runtime (05-06/05-07, not built yet) -- this plan only proves the SEAM: a
 * pose map in, the right Konva nodes move, with zero React re-renders.
 */

import { Profiler, type ProfilerOnRenderCallback } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import Konva from "konva";
import { createStudioTheme, canvasTokensFor } from "../../ui/theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore } from "../../store/mechanismStore";
import { buildExampleFourBar } from "../../store/examples";
import { CanvasStage } from "../CanvasStage";
import { createViewStore, type ViewStore } from "../viewStore";
import { worldToScreen, type Viewport } from "../viewport";
import { buildRenderModel, type RenderModel } from "../renderModel";
import type { PosesSource, TracePrimitive } from "../posesSource";
import {
  indexDocument,
  poseFromWorldPoints,
  siteWorldPosition,
  degToRad,
  type Id,
  type MechanismDocument,
  type Pose,
} from "../../model";

afterEach(cleanup);

/** A minimal, synchronous `PosesSource` test double. */
function createFakePosesSource(): PosesSource & {
  emit(map: ReadonlyMap<Id, Pose> | null): void;
} {
  let current: ReadonlyMap<Id, Pose> | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(map) {
      current = map;
      for (const listener of listeners) listener();
    },
  };
}

function renderStage(
  view: ViewStore,
  extra: { posesSource?: PosesSource; traces?: readonly TracePrimitive[] } = {},
  onRender?: ProfilerOnRenderCallback,
) {
  const store = createMechanismStore();
  const ids = buildExampleFourBar(store);
  const studio = createStudioStore();
  const preferences = createPreferencesStore({ storage: null });
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");

  const stage = (
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
            posesSource={extra.posesSource}
            traces={extra.traces}
          />
        </ThemeProvider>
      </I18nextProvider>
    </div>
  );

  const utils = render(
    onRender ? (
      <Profiler id="sim-layers-test" onRender={onRender}>
        {stage}
      </Profiler>
    ) : (
      stage
    ),
  );
  return { ...utils, store, studio, preferences, ids, doc: store.getState().document };
}

async function waitForStage(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector(".konvajs-content")).toBeTruthy();
  });
  return container.querySelector(".konvajs-content") as HTMLElement;
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

function flatScreen(viewport: Viewport, points: readonly { x: number; y: number }[]): number[] {
  const flat: number[] = [];
  for (const p of points) {
    const s = worldToScreen(viewport, p);
    flat.push(s.x, s.y);
  }
  return flat;
}

function expectClose(actual: number, expected: number, digits = 5): void {
  expect(actual).toBeCloseTo(expected, digits);
}

function expectPointsClose(actual: number[], expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expectClose(actual[i], expected[i]);
}

/**
 * A synthetic (not necessarily kinematically-solved) posed map: rotates the
 * crank about its fixed ground pivot by `extraAngleDeg`, and re-derives the
 * coupler's pose so its shared site with the crank (joint "A") follows,
 * while its OTHER site (joint "B") stays put -- enough to prove the
 * rendering seam without needing a real solve.
 */
function buildSyntheticPosedMap(
  doc: MechanismDocument,
  ids: { crankId: Id; couplerId: Id },
  extraAngleDeg: number,
): Map<Id, Pose> {
  const index = indexDocument(doc);
  const jointA = doc.joints.find((j) => j.name === "A")!;
  const jointB = doc.joints.find((j) => j.name === "B")!;
  const crankSiteALocal = index.sites.get(jointA.siteA)!.site.local;
  const couplerSiteBLocal = index.sites.get(jointB.siteA)!.site.local;

  const crankLink = index.links.get(ids.crankId)!;
  const couplerLink = index.links.get(ids.couplerId)!;

  const posedCrankPose: Pose = {
    position: crankLink.pose.position,
    angle: crankLink.pose.angle + degToRad(extraAngleDeg),
  };
  const newSiteAWorld = siteWorldPosition({ pose: posedCrankPose }, crankSiteALocal);
  const originalSiteBWorld = siteWorldPosition(couplerLink, couplerSiteBLocal);
  const posedCouplerPose = poseFromWorldPoints(newSiteAWorld, originalSiteBWorld);

  return new Map<Id, Pose>([
    [ids.crankId, posedCrankPose],
    [ids.couplerId, posedCouplerPose],
  ]);
}

function couplerLine(stage: Konva.Stage, couplerId: Id): Konva.Line {
  const group = findById<Konva.Group>(stage, `link:${couplerId}`);
  if (!group) throw new Error("coupler link group not found");
  const line = group.findOne<Konva.Line>("Line");
  if (!line) throw new Error("coupler line not found");
  return line;
}

function expectedPlatePoints(model: RenderModel, viewport: Viewport, linkId: Id): number[] {
  const plate = model.plates.find((p) => p.linkId === linkId);
  if (!plate) throw new Error(`no plate for ${linkId}`);
  return flatScreen(viewport, plate.points);
}

describe("Phase 5 posed rendering seam (chromium, real Konva)", () => {
  it("renders the reference pose when posesSource.get() is null", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const posesSource = createFakePosesSource();
    const { container, doc, store } = renderStage(view, { posesSource });
    await waitForStage(container);

    const stage = latestKonvaStage();
    const viewport = view.getState().viewport;
    const model = buildRenderModel(doc, store.getState().selection);

    const line = couplerLine(stage, model.plates[0].linkId);
    expectPointsClose(line.points(), expectedPlatePoints(model, viewport, model.plates[0].linkId));
  });

  it("moves the coupler body, joint-A pin and marker to the posed geometry after emit(), with zero extra React renders", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const posesSource = createFakePosesSource();
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };
    const { container, doc, ids, store } = renderStage(view, { posesSource }, onRender);
    await waitForStage(container);

    const stage = latestKonvaStage();
    const viewport = view.getState().viewport;
    const selection = store.getState().selection;
    const jointA = doc.joints.find((j) => j.name === "A")!;

    const referenceModel = buildRenderModel(doc, selection);
    const referenceLinePoints = expectedPlatePoints(referenceModel, viewport, ids.couplerId);
    const initialLine = couplerLine(stage, ids.couplerId);
    expectPointsClose(initialLine.points(), referenceLinePoints);

    const baseline = renderCount;

    const posedMap = buildSyntheticPosedMap(doc, ids, 25);
    for (let i = 0; i < 10; i++) {
      posesSource.emit(new Map(posedMap));
    }

    expect(renderCount).toBe(baseline); // no React re-render caused by any emission

    const posedModel = buildRenderModel(doc, selection, { poses: posedMap });
    const posedLine = couplerLine(stage, ids.couplerId);
    expectPointsClose(posedLine.points(), expectedPlatePoints(posedModel, viewport, ids.couplerId));

    const pin = findById<Konva.Circle>(stage, `pin:${jointA.id}`)!;
    const pinPoint = posedModel.pins.find((p) => p.jointId === jointA.id)!.point;
    const pinScreen = worldToScreen(viewport, pinPoint);
    expectClose(pin.x(), pinScreen.x);
    expectClose(pin.y(), pinScreen.y);

    const markerGroup = findById<Konva.Group>(stage, `marker:${ids.markerId}`)!;
    const markerPoint = posedModel.markers.find((m) => m.markerId === ids.markerId)!.point;
    const markerScreen = worldToScreen(viewport, markerPoint);
    expectClose(markerGroup.x(), markerScreen.x);
    expectClose(markerGroup.y(), markerScreen.y);
  });

  it("emit(null) returns every node to the reference-pose projection exactly", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const posesSource = createFakePosesSource();
    const { container, doc, ids, store } = renderStage(view, { posesSource });
    await waitForStage(container);

    const stage = latestKonvaStage();
    const viewport = view.getState().viewport;
    const selection = store.getState().selection;

    const posedMap = buildSyntheticPosedMap(doc, ids, 25);
    posesSource.emit(posedMap);
    posesSource.emit(null);

    const referenceModel = buildRenderModel(doc, selection);
    const line = couplerLine(stage, ids.couplerId);
    expectPointsClose(line.points(), expectedPlatePoints(referenceModel, viewport, ids.couplerId));
  });

  it("a React re-render caused by a viewport change renders the POSED geometry while a posed map is active", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const posesSource = createFakePosesSource();
    const { container, doc, ids, store } = renderStage(view, { posesSource });
    await waitForStage(container);

    const selection = store.getState().selection;
    const posedMap = buildSyntheticPosedMap(doc, ids, 25);
    posesSource.emit(posedMap);

    view.getState().zoomAtScreen({ x: 400, y: 300 }, 1.5);

    await waitFor(() => {
      const stage = latestKonvaStage();
      const viewport = view.getState().viewport;
      const posedModel = buildRenderModel(doc, selection, { poses: posedMap });
      const line = couplerLine(stage, ids.couplerId);
      expectPointsClose(line.points(), expectedPlatePoints(posedModel, viewport, ids.couplerId));
    });
  });

  it("the existing CanvasStage.chromium.test.tsx suite stays green with no posesSource/traces passed (Build mode unchanged)", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container, doc, store } = renderStage(view);
    await waitForStage(container);

    const stage = latestKonvaStage();
    const viewport = view.getState().viewport;
    const model = buildRenderModel(doc, store.getState().selection);
    for (const plate of model.plates) {
      const line = couplerLine(stage, plate.linkId);
      expectPointsClose(line.points(), flatScreen(viewport, plate.points));
    }
  });
});

describe("TracesLayer via CanvasStage (chromium, real Konva)", () => {
  it("renders a closed trace Line, painted before the links layer, with no trace nodes when traces is empty/undefined", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const traceMarkerId = "trace-marker";
    const traces: TracePrimitive[] = [
      { markerId: traceMarkerId, points: [0, 0, 50, 0, 50, 50, 0, 50], closed: true },
    ];
    const { container, ids } = renderStage(view, { traces });
    await waitForStage(container);

    const stage = latestKonvaStage();
    const viewport = view.getState().viewport;
    const tokens = canvasTokensFor("light");

    const traceLine = findById<Konva.Line>(stage, `trace:${traceMarkerId}`);
    expect(traceLine).toBeTruthy();
    expect(traceLine!.closed()).toBe(true);
    expect(traceLine!.stroke()).toBe(tokens.accent);
    expectPointsClose(
      traceLine!.points(),
      flatScreen(viewport, [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
      ]),
    );

    const traceLayer = traceLine!.getLayer()!;
    const linksGroup = findById<Konva.Group>(stage, `link:${ids.couplerId}`)!;
    const linksLayer = linksGroup.getLayer()!;
    const layers = stage.getChildren();
    expect(layers.indexOf(traceLayer)).toBeLessThan(layers.indexOf(linksLayer));
  });

  it("renders no trace nodes when traces is undefined", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container } = renderStage(view);
    await waitForStage(container);

    const stage = latestKonvaStage();
    const anyTrace = stage.findOne((n: Konva.Node) => n.id().startsWith("trace:"));
    expect(anyTrace).toBeUndefined();
  });

  it("renders no trace nodes when traces is an empty array", async () => {
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { container } = renderStage(view, { traces: [] });
    await waitForStage(container);

    const stage = latestKonvaStage();
    const anyTrace = stage.findOne((n: Konva.Node) => n.id().startsWith("trace:"));
    expect(anyTrace).toBeUndefined();
  });
});
