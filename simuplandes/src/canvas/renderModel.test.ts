import { describe, it, expect } from "vitest";
import { buildRenderModel } from "./renderModel";
import { createMechanismStore } from "../store/mechanismStore";
import { buildExampleFourBar } from "../store/examples";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";
import { LINK_TYPE_COLORS } from "../ui/theme/tokens";

describe("buildRenderModel: geometrically-valid four-bar (store example)", () => {
  const store = createMechanismStore();
  buildExampleFourBar(store);
  const doc = store.getState().document;

  it("yields 4 bars/plates, 2 ground pivots, 4 pins and 1 motor", () => {
    const model = buildRenderModel(doc, new Set());
    expect(model.bars.length + model.plates.length).toBe(4);
    expect(model.groundPivots.length).toBe(2);
    expect(model.pins.length).toBe(4);
    expect(model.motors.length).toBe(1);
  });

  it("every R joint's pin is coincident (this fixture is geometrically closed)", () => {
    const model = buildRenderModel(doc, new Set());
    for (const pin of model.pins) {
      expect(pin.coincident).toBe(true);
    }
  });

  it("marks the coupler plate as selected when its id is in the selection", () => {
    const coupler = doc.links.find((l) => l.name === "coupler")!;
    const model = buildRenderModel(doc, new Set([coupler.id]));
    const platePrimitive = model.plates.find((p) => p.linkId === coupler.id);
    expect(platePrimitive?.selected).toBe(true);
    const crank = doc.links.find((l) => l.name === "crank")!;
    const barPrimitive = model.bars.find((b) => b.linkId === crank.id);
    expect(barPrimitive?.selected).toBe(false);
  });

  it("uses the link-type palette color when the link has no explicit color", () => {
    const model = buildRenderModel(doc, new Set());
    const groundLink = doc.links.find((l) => l.isGround)!;
    const groundBar = model.bars.find((b) => b.linkId === groundLink.id);
    expect(groundBar?.color).toBe(LINK_TYPE_COLORS.ground);
  });

  it("has no free sites (every site in the four-bar has a joint)", () => {
    const model = buildRenderModel(doc, new Set());
    expect(model.freeSites).toEqual([]);
  });
});

describe("buildRenderModel: non-coincident joint (schema fixture, not geometrically solved)", () => {
  it("flags a pin whose two sites do not coincide", () => {
    const model = buildRenderModel(fourBarFixtureParsed, new Set());
    const joint3Pin = model.pins.find((p) => p.jointId === "joint-3");
    expect(joint3Pin?.coincident).toBe(false);
    const joint1Pin = model.pins.find((p) => p.jointId === "joint-1");
    expect(joint1Pin?.coincident).toBe(true);
  });

  it("draws a bar link as a polyline through its sites in order", () => {
    const model = buildRenderModel(fourBarFixtureParsed, new Set());
    const rocker = model.bars.find((b) => b.linkId === "link-4")!;
    expect(rocker.points).toEqual([
      { x: 140, y: 0 },
      { x: 110, y: 40 },
    ]);
  });

  it("draws a plate as its world-transformed outline", () => {
    const model = buildRenderModel(fourBarFixtureParsed, new Set());
    const coupler = model.plates.find((p) => p.linkId === "link-3")!;
    expect(coupler.points).toEqual([
      { x: 35, y: -10 },
      { x: 95, y: -10 },
      { x: 95, y: 10 },
      { x: 35, y: 10 },
    ]);
  });

  it("places the marker at its world position", () => {
    const model = buildRenderModel(fourBarFixtureParsed, new Set());
    expect(model.markers).toEqual([{ markerId: "marker-1", point: { x: 65, y: 0 } }]);
  });
});

describe("buildRenderModel: pose-override seam (Phase 5)", () => {
  it("moves a link's primitives when options.poses overrides its pose", () => {
    const withoutOverride = buildRenderModel(fourBarFixtureParsed, new Set());
    const crankBefore = withoutOverride.bars.find((b) => b.linkId === "link-2")!;
    expect(crankBefore.points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);

    const poses = new Map([["link-2", { position: [10, 20] as [number, number], angle: 0 }]]);
    const withOverride = buildRenderModel(fourBarFixtureParsed, new Set(), { poses });
    const crankAfter = withOverride.bars.find((b) => b.linkId === "link-2")!;
    expect(crankAfter.points).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
    ]);

    // Other links are untouched by an override that targets only one link id.
    const rockerAfter = withOverride.bars.find((b) => b.linkId === "link-4")!;
    expect(rockerAfter.points).toEqual([
      { x: 140, y: 0 },
      { x: 110, y: 40 },
    ]);
  });
});

describe("buildRenderModel: a single-site bar renders just the site", () => {
  it("produces a 1-point bar primitive", () => {
    const store = createMechanismStore();
    const { linkId } = store.getState().addLink({
      name: "stub",
      sites: [{ local: [5, 5] }],
    });
    const model = buildRenderModel(store.getState().document, new Set());
    const bar = model.bars.find((b) => b.linkId === linkId)!;
    expect(bar.points).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("buildRenderModel: hover/issue flags (GRF-02/GRF-03)", () => {
  const store = createMechanismStore();
  const ids = buildExampleFourBar(store);
  const doc = store.getState().document;

  it("with no options, every hovered/issue flag is false and pins/sliders are unselected", () => {
    const model = buildRenderModel(doc, new Set());
    for (const bar of model.bars) {
      expect(bar.hovered).toBe(false);
      expect(bar.issue).toBe(false);
    }
    for (const plate of model.plates) {
      expect(plate.hovered).toBe(false);
      expect(plate.issue).toBe(false);
    }
    for (const pivot of model.groundPivots) {
      expect(pivot.hovered).toBe(false);
      expect(pivot.issue).toBe(false);
    }
    for (const pin of model.pins) {
      expect(pin.selected).toBe(false);
      expect(pin.hovered).toBe(false);
    }
  });

  it("hoverId naming a link hovers only that link's bar/plate", () => {
    const model = buildRenderModel(doc, new Set(), { hoverId: ids.crankId });
    const crankBar = model.bars.find((b) => b.linkId === ids.crankId)!;
    expect(crankBar.hovered).toBe(true);
    for (const bar of model.bars) {
      if (bar.linkId !== ids.crankId) expect(bar.hovered).toBe(false);
    }
    for (const plate of model.plates) {
      expect(plate.hovered).toBe(false);
    }
  });

  it("hoverId naming a joint hovers only that joint's pin, no link hovered", () => {
    const jointA = doc.joints.find((j) => j.name === "A")!;
    const model = buildRenderModel(doc, new Set(), { hoverId: jointA.id });
    const pin = model.pins.find((p) => p.jointId === jointA.id)!;
    expect(pin.hovered).toBe(true);
    for (const pin2 of model.pins) {
      if (pin2.jointId !== jointA.id) expect(pin2.hovered).toBe(false);
    }
    for (const bar of model.bars) expect(bar.hovered).toBe(false);
    for (const plate of model.plates) expect(plate.hovered).toBe(false);
  });

  it("hoverId naming the ground link hovers that ground link's ground pivots", () => {
    const model = buildRenderModel(doc, new Set(), { hoverId: ids.groundId });
    expect(model.groundPivots.length).toBeGreaterThan(0);
    for (const pivot of model.groundPivots) {
      expect(pivot.hovered).toBe(true);
    }
  });

  it("issueLinkIds flags exactly those bars/plates, and a ground id flags its ground pivots", () => {
    const model = buildRenderModel(doc, new Set(), {
      issueLinkIds: new Set([ids.couplerId, ids.groundId]),
    });
    const couplerPlate = model.plates.find((p) => p.linkId === ids.couplerId)!;
    expect(couplerPlate.issue).toBe(true);
    const crankBar = model.bars.find((b) => b.linkId === ids.crankId)!;
    expect(crankBar.issue).toBe(false);
    for (const pivot of model.groundPivots) {
      expect(pivot.issue).toBe(true);
    }
  });

  it("selection containing a joint id marks that pin selected", () => {
    const jointA = doc.joints.find((j) => j.name === "A")!;
    const model = buildRenderModel(doc, new Set([jointA.id]));
    const pin = model.pins.find((p) => p.jointId === jointA.id)!;
    expect(pin.selected).toBe(true);
    for (const pin2 of model.pins) {
      if (pin2.jointId !== jointA.id) expect(pin2.selected).toBe(false);
    }
  });

  it("poses and the new hover/issue options both apply together", () => {
    const poses = new Map([["link-2", { position: [10, 20] as [number, number], angle: 0 }]]);
    const model = buildRenderModel(fourBarFixtureParsed, new Set(), {
      poses,
      hoverId: "link-2",
      issueLinkIds: new Set(["link-4"]),
    });
    const crank = model.bars.find((b) => b.linkId === "link-2")!;
    expect(crank.hovered).toBe(true);
    expect(crank.points).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
    ]);
    const rocker = model.bars.find((b) => b.linkId === "link-4")!;
    expect(rocker.issue).toBe(true);
  });
});

describe("buildRenderModel: sliders", () => {
  it("computes the world slide axis by rotating the local axis by siteA's link angle", () => {
    const store = createMechanismStore();
    const ground = store.getState().addLink({
      name: "ground",
      isGround: true,
      pose: { position: [0, 0], angle: Math.PI / 2 },
      sites: [{ local: [0, 0] }],
    });
    const block = store.getState().addLink({
      name: "block",
      pose: { position: [0, 0], angle: 0 },
      sites: [{ local: [0, 0] }],
    });
    const jointId = store.getState().addJoint({
      type: "P",
      siteA: ground.siteIds[0],
      siteB: block.siteIds[0],
      axis: [1, 0],
    });
    const model = buildRenderModel(store.getState().document, new Set());
    const slider = model.sliders.find((s) => s.jointId === jointId)!;
    // axis [1,0] rotated by 90deg (ground's angle) -> world axis (0,1).
    expect(slider.axisWorld.x).toBeCloseTo(0, 9);
    expect(slider.axisWorld.y).toBeCloseTo(1, 9);
    expect(slider.blockAngle).toBeCloseTo(Math.PI / 2, 9);
  });
});
