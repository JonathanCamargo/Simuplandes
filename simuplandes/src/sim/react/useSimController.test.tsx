// @vitest-environment jsdom
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSimController } from "./useSimController";
import { createStudioStore } from "../../uiState/studioStore";
import {
  createMechanismStore,
  buildExampleFourBar,
  addSite,
  type MechanismStore,
} from "../../store";
import { createSimStore } from "../simStore";
import { createSimRuntime, type FrameScheduler } from "../runtime";
import { createViewStore } from "../../canvas/viewStore";
import type { CanvasPointerEvent } from "../../canvas/CanvasStage";
import { localToWorld, type Vec2 } from "../../geom";
import {
  poseFromWorldPoints,
  worldToLinkLocal,
  type Id,
  type MechanismDocument,
  type Pose,
} from "../../model";

afterEach(cleanup);

/** A manual, deterministic `FrameScheduler` (mirrors `runtime.test.ts`'s own): this hook's drag
 * calls (`beginDrag`/`dragTo`/`endDrag`) never schedule a frame, but `createSimRuntime` still
 * requires one. */
class FakeScheduler implements FrameScheduler {
  private nowMs = 0;
  now(): number {
    return this.nowMs;
  }
  request(): number {
    return 0;
  }
  cancel(): void {}
}

function makeEvent(
  type: CanvasPointerEvent["type"],
  world: Vec2,
  overrides?: Partial<CanvasPointerEvent>,
): CanvasPointerEvent {
  return {
    type,
    screen: world,
    world,
    snap: { kind: "none", point: world },
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

function poseOf(doc: MechanismDocument, poses: ReadonlyMap<Id, Pose> | null, linkId: Id): Pose {
  const posed = poses?.get(linkId);
  if (posed) return posed;
  return doc.links.find((l) => l.id === linkId)!.pose;
}

/** A world point safely inside the coupler PLATE body (30% along its base, away from every
 * site/marker/joint), under `poses` (or the document's reference pose when `poses` is `null`). */
function couplerBodyPoint(doc: MechanismDocument, poses: ReadonlyMap<Id, Pose> | null): Vec2 {
  const coupler = doc.links.find((l) => l.name === "coupler")!;
  if (coupler.shape.kind !== "plate") throw new Error("expected the coupler to be a plate");
  const abLength = coupler.shape.outline[1][0];
  const pose = poseOf(doc, poses, coupler.id);
  return localToWorld(
    { x: abLength * 0.3, y: 5 },
    { x: pose.position[0], y: pose.position[1] },
    pose.angle,
  );
}

/** Every R joint's site-to-site gap under `poses` (falls back to `link.pose` for any link
 * `poses` doesn't cover) -- the same "stays assembled" notion `e2e/helpers.ts`'s
 * `maxJointResidual` checks in the browser, computed here purely from posed positions so the
 * unit test doesn't need a compiled `KinematicSystem`'s raw `q`/`inputs` vectors. */
function maxSiteGap(doc: MechanismDocument, poses: ReadonlyMap<Id, Pose> | null): number {
  let max = 0;
  for (const joint of doc.joints) {
    if (joint.type !== "R") continue;
    const linkA = doc.links.find((l) => l.sites.some((s) => s.id === joint.siteA))!;
    const linkB = doc.links.find((l) => l.sites.some((s) => s.id === joint.siteB))!;
    const siteA = linkA.sites.find((s) => s.id === joint.siteA)!;
    const siteB = linkB.sites.find((s) => s.id === joint.siteB)!;
    const poseA = poseOf(doc, poses, linkA.id);
    const poseB = poseOf(doc, poses, linkB.id);
    const worldA = localToWorld(
      { x: siteA.local[0], y: siteA.local[1] },
      { x: poseA.position[0], y: poseA.position[1] },
      poseA.angle,
    );
    const worldB = localToWorld(
      { x: siteB.local[0], y: siteB.local[1] },
      { x: poseB.position[0], y: poseB.position[1] },
      poseB.angle,
    );
    max = Math.max(max, Math.hypot(worldA.x - worldB.x, worldA.y - worldB.y));
  }
  return max;
}

function setup() {
  const mechanismStore = createMechanismStore();
  const ids = buildExampleFourBar(mechanismStore);
  const studio = createStudioStore();
  const simStore = createSimStore();
  const scheduler = new FakeScheduler();
  const runtime = createSimRuntime({ store: simStore, scheduler });
  const view = createViewStore({ widthPx: 800, heightPx: 600 });
  runtime.enter(mechanismStore.getState().document);
  const { result } = renderHook(() =>
    useSimController({ mechanismStore, studio, simStore, runtime, view }),
  );
  return { mechanismStore, ids, studio, simStore, runtime, view, controller: result };
}

/** `buildExampleFourBar` plus a fifth bar rigidly pinning the crank's site A to ground's site
 * O4: a truss, 0 DOF, not-drivable (mirrors `e2e/simulate-mode.spec.ts`'s own truss builder). */
function buildTrussDocument(): { store: MechanismStore; doc: MechanismDocument } {
  const store = createMechanismStore();
  const ids = buildExampleFourBar(store);
  const doc = store.getState().document;
  const jointA = doc.joints.find((j) => j.name === "A")!;
  const jointO4 = doc.joints.find((j) => j.name === "O4")!;
  const crank = doc.links.find((l) => l.id === ids.crankId)!;
  const ground = doc.links.find((l) => l.id === ids.groundId)!;
  const crankSiteA = crank.sites.find((s) => s.id === jointA.siteA)!;
  const groundSiteO4 = ground.sites.find((s) => s.id === jointO4.siteB)!;

  const worldA = localToWorld(
    { x: crankSiteA.local[0], y: crankSiteA.local[1] },
    { x: crank.pose.position[0], y: crank.pose.position[1] },
    crank.pose.angle,
  );
  const worldO4 = localToWorld(
    { x: groundSiteO4.local[0], y: groundSiteO4.local[1] },
    { x: ground.pose.position[0], y: ground.pose.position[1] },
    ground.pose.angle,
  );
  const fifthPose = poseFromWorldPoints(worldA, worldO4);
  const fifth = store.getState().addLink({
    name: "fifth-bar",
    pose: fifthPose,
    sites: [
      { local: worldToLinkLocal(fifthPose, worldA) },
      { local: worldToLinkLocal(fifthPose, worldO4) },
    ],
  });
  store
    .getState()
    .addJoint({ type: "R", siteA: crankSiteA.id, siteB: fifth.siteIds[0], name: "fifth-A" });
  store
    .getState()
    .addJoint({ type: "R", siteA: groundSiteO4.id, siteB: fifth.siteIds[1], name: "fifth-O4" });

  return { store, doc: store.getState().document };
}

describe("useSimController", () => {
  it("pointerdown on the coupler body at its POSED position begins a drag on the coupler", () => {
    const { mechanismStore, ids, simStore, controller } = setup();
    const doc = mechanismStore.getState().document;
    const point = couplerBodyPoint(doc, simStore.getState().poses);

    act(() => controller.current.onPointer(makeEvent("pointerdown", point)));

    expect(simStore.getState().dragging).toEqual({ linkId: ids.couplerId });
  });

  it("the SAME pointerdown at the coupler's REFERENCE position after scrubbing is NOT hit (research Pitfall 1)", () => {
    const { mechanismStore, runtime, simStore, controller } = setup();
    const doc = mechanismStore.getState().document;

    runtime.scrubTo(150);
    const posed = simStore.getState().poses;
    expect(posed).not.toBeNull();

    // The scrub must have actually moved the coupler for this test to mean anything.
    const referencePoint = couplerBodyPoint(doc, null);
    const posedPoint = couplerBodyPoint(doc, posed);
    expect(
      Math.hypot(referencePoint.x - posedPoint.x, referencePoint.y - posedPoint.y),
    ).toBeGreaterThan(15);

    act(() => controller.current.onPointer(makeEvent("pointerdown", referencePoint)));

    expect(simStore.getState().dragging).toBeNull();
  });

  it("pointerdown on a marker drags the marker's own link", () => {
    const { mechanismStore, ids, simStore, controller } = setup();
    const doc = mechanismStore.getState().document;
    const marker = doc.markers[0];
    expect(marker.linkId).toBe(ids.couplerId);
    const pose = poseOf(doc, simStore.getState().poses, marker.linkId);
    const point = localToWorld(
      { x: marker.local[0], y: marker.local[1] },
      { x: pose.position[0], y: pose.position[1] },
      pose.angle,
    );

    act(() => controller.current.onPointer(makeEvent("pointerdown", point)));

    expect(simStore.getState().dragging).toEqual({ linkId: ids.couplerId });
  });

  it("pointerdown on a joint shared by a moving link and ground (O2) drags the moving link (crank), not ground", () => {
    const { mechanismStore, ids, simStore, controller } = setup();
    const doc = mechanismStore.getState().document;
    const jointO2 = doc.joints.find((j) => j.name === "O2")!;
    const ground = doc.links.find((l) => l.id === ids.groundId)!;
    const groundSiteO2 = ground.sites.find((s) => s.id === jointO2.siteA)!;
    const pose = poseOf(doc, simStore.getState().poses, ground.id);
    const point = localToWorld(
      { x: groundSiteO2.local[0], y: groundSiteO2.local[1] },
      { x: pose.position[0], y: pose.position[1] },
      pose.angle,
    );

    act(() => controller.current.onPointer(makeEvent("pointerdown", point)));

    expect(simStore.getState().dragging).toEqual({ linkId: ids.crankId });
  });

  it("pointerdown on a site of a moving link (no joint) drags that link; the same free site on ground does nothing", () => {
    const { mechanismStore, ids, simStore, controller } = setup();
    mechanismStore
      .getState()
      .execute("add probe site", [
        addSite(ids.couplerId, { id: "probe-site-coupler", local: [10, 3] }),
        addSite(ids.groundId, { id: "probe-site-ground", local: [40, 15] }),
      ]);
    const doc = mechanismStore.getState().document;
    const couplerProbe = doc.links
      .find((l) => l.id === ids.couplerId)!
      .sites.find((s) => s.id === "probe-site-coupler")!;
    const groundProbe = doc.links
      .find((l) => l.id === ids.groundId)!
      .sites.find((s) => s.id === "probe-site-ground")!;

    const couplerPose = poseOf(doc, simStore.getState().poses, ids.couplerId);
    const couplerPoint = localToWorld(
      { x: couplerProbe.local[0], y: couplerProbe.local[1] },
      { x: couplerPose.position[0], y: couplerPose.position[1] },
      couplerPose.angle,
    );
    act(() => controller.current.onPointer(makeEvent("pointerdown", couplerPoint)));
    expect(simStore.getState().dragging).toEqual({ linkId: ids.couplerId });

    act(() => controller.current.onPointer(makeEvent("pointerup", couplerPoint)));
    expect(simStore.getState().dragging).toBeNull();

    const groundPose = poseOf(doc, simStore.getState().poses, ids.groundId);
    const groundPoint = localToWorld(
      { x: groundProbe.local[0], y: groundProbe.local[1] },
      { x: groundPose.position[0], y: groundPose.position[1] },
      groundPose.angle,
    );
    act(() => controller.current.onPointer(makeEvent("pointerdown", groundPoint)));
    expect(simStore.getState().dragging).toBeNull();
  });

  it("dragging empty space, or the ground body, does nothing", () => {
    const { simStore, controller } = setup();

    act(() => controller.current.onPointer(makeEvent("pointerdown", { x: 500, y: 500 })));
    expect(simStore.getState().dragging).toBeNull();

    // The ground bar runs from (0,0) to (100,0); its midpoint is far from
    // either of its two sites (well outside the 8/zoom hit radius).
    act(() => controller.current.onPointer(makeEvent("pointerdown", { x: 50, y: 0 })));
    expect(simStore.getState().dragging).toBeNull();
  });

  it("ignores button !== 0, and ignores every button while the active tool isn't 'select'", () => {
    const { mechanismStore, simStore, studio, controller } = setup();
    const doc = mechanismStore.getState().document;
    const point = couplerBodyPoint(doc, simStore.getState().poses);

    act(() => controller.current.onPointer(makeEvent("pointerdown", point, { button: 1 })));
    expect(simStore.getState().dragging).toBeNull();

    studio.getState().setActiveTool("pan");
    act(() => controller.current.onPointer(makeEvent("pointerdown", point)));
    expect(simStore.getState().dragging).toBeNull();
  });

  it("pointermove without an active drag does nothing", () => {
    const { mechanismStore, simStore, controller } = setup();
    const doc = mechanismStore.getState().document;
    const point = couplerBodyPoint(doc, simStore.getState().poses);
    const before = simStore.getState().poses;

    act(() => controller.current.onPointer(makeEvent("pointermove", point)));

    expect(simStore.getState().poses).toBe(before);
    expect(simStore.getState().dragging).toBeNull();
  });

  it("a not-drivable session: beginDrag returns false internally, and moves do nothing", () => {
    const { doc } = buildTrussDocument();
    const studio = createStudioStore();
    const simStore = createSimStore();
    const runtime = createSimRuntime({ store: simStore, scheduler: new FakeScheduler() });
    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    runtime.enter(doc);
    expect(simStore.getState().session?.status).toBe("not-drivable");

    const mechanismStore = createMechanismStore({ initialDocument: doc });
    const { result: controller } = renderHook(() =>
      useSimController({ mechanismStore, studio, simStore, runtime, view }),
    );
    const point = couplerBodyPoint(doc, simStore.getState().poses);

    act(() => controller.current.onPointer(makeEvent("pointerdown", point)));
    expect(simStore.getState().dragging).toBeNull();

    act(() =>
      controller.current.onPointer(makeEvent("pointermove", { x: point.x + 5, y: point.y })),
    );
    expect(simStore.getState().dragging).toBeNull();
  });

  describe("drag lifecycle", () => {
    it("pointermove after a successful pointerdown drives the mechanism, keeps every joint assembled, and pointerup ends the drag", () => {
      const { mechanismStore, ids, simStore, controller } = setup();
      const doc = mechanismStore.getState().document;
      const startPoint = couplerBodyPoint(doc, simStore.getState().poses);
      const startCrankAngle = poseOf(doc, simStore.getState().poses, ids.crankId).angle;

      act(() => controller.current.onPointer(makeEvent("pointerdown", startPoint)));
      expect(simStore.getState().dragging).toEqual({ linkId: ids.couplerId });

      // Several moves toward a point off the coupler curve (the IK moves to
      // the nearest reachable point, changing the crank input).
      const target = { x: startPoint.x - 25, y: startPoint.y + 15 };
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const world = {
          x: startPoint.x + (target.x - startPoint.x) * t,
          y: startPoint.y + (target.y - startPoint.y) * t,
        };
        act(() => controller.current.onPointer(makeEvent("pointermove", world)));
        expect(maxSiteGap(doc, simStore.getState().poses)).toBeLessThan(1e-9);
      }

      const endCrankAngle = poseOf(doc, simStore.getState().poses, ids.crankId).angle;
      expect(Math.abs(endCrankAngle - startCrankAngle)).toBeGreaterThan((1 * Math.PI) / 180);

      act(() => controller.current.onPointer(makeEvent("pointerup", target)));
      expect(simStore.getState().dragging).toBeNull();
    });

    it("never writes to the mechanism store: history/document identity is unchanged after a full drag", () => {
      const { mechanismStore, simStore, controller } = setup();
      const doc = mechanismStore.getState().document;
      const before = mechanismStore.getState();
      const startPoint = couplerBodyPoint(doc, simStore.getState().poses);

      act(() => controller.current.onPointer(makeEvent("pointerdown", startPoint)));
      act(() =>
        controller.current.onPointer(
          makeEvent("pointermove", { x: startPoint.x - 10, y: startPoint.y + 8 }),
        ),
      );
      act(() =>
        controller.current.onPointer(
          makeEvent("pointerup", { x: startPoint.x - 10, y: startPoint.y + 8 }),
        ),
      );

      const after = mechanismStore.getState();
      expect(after.document).toBe(before.document);
      expect(after.canUndo).toBe(before.canUndo);
      expect(after.canRedo).toBe(before.canRedo);
    });
  });
});
