import { describe, it, expect } from "vitest";
import { produce } from "immer";
import {
  resolveInspectorTarget,
  barLength,
  setBarLengthRecipes,
  moveSiteClusterRecipes,
  linkPoseRecipe,
  jointWorldPosition,
  jointAxisWorldAngleDeg,
  setJointAxisFromWorldAngleRecipe,
  markerWorldRecipes,
  motorSpeedDisplay,
  motorSpeedFromDisplay,
} from "./edits";
import { addLink, addJoint, CommandError, type Recipe } from "../../store/commands";
import { createMechanismStore } from "../../store/mechanismStore";
import {
  createEmptyDocument,
  siteWorldPosition,
  indexDocument,
  type MechanismDocument,
  type PrismaticJoint,
  type Marker,
} from "../../model";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";

function applyRecipes(doc: MechanismDocument, recipes: Recipe[] | Recipe): MechanismDocument {
  const list = Array.isArray(recipes) ? recipes : [recipes];
  return list.reduce((acc, recipe) => produce(acc, recipe), doc);
}

describe("resolveInspectorTarget", () => {
  it("empty selection -> document", () => {
    expect(resolveInspectorTarget(fourBarFixtureParsed, new Set())).toEqual({ kind: "document" });
  });

  it("one link id -> link", () => {
    const target = resolveInspectorTarget(fourBarFixtureParsed, new Set(["link-2"]));
    expect(target.kind).toBe("link");
    expect(target.kind === "link" && target.link.id).toBe("link-2");
  });

  it("one joint id -> joint", () => {
    const target = resolveInspectorTarget(fourBarFixtureParsed, new Set(["joint-1"]));
    expect(target.kind).toBe("joint");
    expect(target.kind === "joint" && target.joint.id).toBe("joint-1");
  });

  it("a site that belongs to a joint -> that joint, via jointsBySite", () => {
    const target = resolveInspectorTarget(fourBarFixtureParsed, new Set(["site-1"]));
    expect(target.kind).toBe("joint");
    expect(target.kind === "joint" && target.joint.id).toBe("joint-1");
  });

  it("a free site (no joints) -> site", () => {
    const doc = applyRecipes(fourBarFixtureParsed, [
      addLink({ id: "link-free", name: "free", sites: [{ id: "site-free", local: [1, 1] }] }),
    ]);
    const target = resolveInspectorTarget(doc, new Set(["site-free"]));
    expect(target.kind).toBe("site");
    expect(target.kind === "site" && target.site.id).toBe("site-free");
    expect(target.kind === "site" && target.link.id).toBe("link-free");
  });

  it("a motor id -> motor", () => {
    const target = resolveInspectorTarget(fourBarFixtureParsed, new Set(["motor-1"]));
    expect(target.kind).toBe("motor");
    expect(target.kind === "motor" && target.motor.id).toBe("motor-1");
  });

  it("a marker id -> marker", () => {
    const target = resolveInspectorTarget(fourBarFixtureParsed, new Set(["marker-1"]));
    expect(target.kind).toBe("marker");
    expect(target.kind === "marker" && target.marker.id).toBe("marker-1");
  });

  it("two or more ids -> multi(count)", () => {
    expect(resolveInspectorTarget(fourBarFixtureParsed, new Set(["link-1", "link-2"]))).toEqual({
      kind: "multi",
      count: 2,
    });
  });

  it("an id matching nothing in the document falls back to document (defensive, e.g. stale selection)", () => {
    expect(resolveInspectorTarget(fourBarFixtureParsed, new Set(["nope"]))).toEqual({
      kind: "document",
    });
  });
});

describe("barLength", () => {
  it("returns the distance between a two-site link's sites", () => {
    const crank = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!crank) throw new Error("fixture missing link-2");
    expect(barLength(crank)).toBe(40);
  });

  it("returns null for a link that does not have exactly two sites", () => {
    const doc = applyRecipes(fourBarFixtureParsed, [
      addLink({ id: "link-one", name: "one", sites: [{ id: "site-one", local: [0, 0] }] }),
      addLink({
        id: "link-three",
        name: "three",
        sites: [
          { id: "s3-1", local: [0, 0] },
          { id: "s3-2", local: [1, 0] },
          { id: "s3-3", local: [1, 1] },
        ],
      }),
    ]);
    const one = doc.links.find((l) => l.id === "link-one");
    const three = doc.links.find((l) => l.id === "link-three");
    if (!one || !three) throw new Error("fixture setup failed");
    expect(barLength(one)).toBeNull();
    expect(barLength(three)).toBeNull();
  });
});

describe("setBarLengthRecipes", () => {
  it("keeps site 0 fixed and sets the length exactly for an axis-aligned bar, moving the R-cluster partner too", () => {
    const crank = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!crank) throw new Error("fixture missing link-2");
    const recipes = setBarLengthRecipes(fourBarFixtureParsed, crank, 120);
    const result = applyRecipes(fourBarFixtureParsed, recipes);

    const newCrank = result.links.find((l) => l.id === "link-2");
    if (!newCrank) throw new Error("result missing link-2");
    expect(newCrank.sites[0].local).toEqual([0, 0]);
    expect(newCrank.sites[1].local).toEqual([120, 0]);
    expect(barLength(newCrank)).toBe(120);

    // site-4 (crank.B) is R-jointed (joint-2) to site-5 (coupler.A): both must land at the same world point.
    const crankBWorld = siteWorldPosition(newCrank, newCrank.sites[1].local);
    const coupler = result.links.find((l) => l.id === "link-3");
    if (!coupler) throw new Error("result missing link-3");
    const couplerAWorld = siteWorldPosition(
      coupler,
      coupler.sites.find((s) => s.id === "site-5")?.local ?? [NaN, NaN],
    );
    expect(couplerAWorld.x).toBeCloseTo(crankBWorld.x, 9);
    expect(couplerAWorld.y).toBeCloseTo(crankBWorld.y, 9);
  });

  it("keeps the length exact within 1e-12 for a non-axis-aligned bar", () => {
    const doc = applyRecipes(createEmptyDocument(), [
      addLink({
        id: "link-r",
        name: "r",
        pose: { position: [5, -3], angle: Math.PI / 7 },
        sites: [
          { id: "site-r1", local: [0, 0] },
          { id: "site-r2", local: [12, -4] },
        ],
      }),
    ]);
    const link = doc.links.find((l) => l.id === "link-r");
    if (!link) throw new Error("fixture missing link-r");
    const recipes = setBarLengthRecipes(doc, link, 77);
    const result = applyRecipes(doc, recipes);
    const newLink = result.links.find((l) => l.id === "link-r");
    if (!newLink) throw new Error("result missing link-r");
    expect(barLength(newLink)).toBeCloseTo(77, 12);
  });

  it("throws CommandError for a non-positive length", () => {
    const crank = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!crank) throw new Error("fixture missing link-2");
    expect(() => setBarLengthRecipes(fourBarFixtureParsed, crank, 0)).toThrow(CommandError);
    expect(() => setBarLengthRecipes(fourBarFixtureParsed, crank, -5)).toThrow(CommandError);
  });

  it("throws CommandError for a link that is not a two-site bar", () => {
    const doc = applyRecipes(fourBarFixtureParsed, [
      addLink({ id: "link-one", name: "one", sites: [{ id: "site-one", local: [0, 0] }] }),
    ]);
    const link = doc.links.find((l) => l.id === "link-one");
    if (!link) throw new Error("fixture missing link-one");
    expect(() => setBarLengthRecipes(doc, link, 10)).toThrow(CommandError);
  });
});

describe("moveSiteClusterRecipes", () => {
  it("skips a cluster id that is not an actual site (defensive; e.g. an unknown starting id)", () => {
    expect(moveSiteClusterRecipes(fourBarFixtureParsed, "nope", { x: 0, y: 0 })).toEqual([]);
  });

  it("moves every cluster site to the same world point", () => {
    const recipes = moveSiteClusterRecipes(fourBarFixtureParsed, "site-4", { x: 200, y: 50 });
    const result = applyRecipes(fourBarFixtureParsed, recipes);
    const index = indexDocument(result);
    for (const id of ["site-4", "site-5"]) {
      const entry = index.sites.get(id);
      if (!entry) throw new Error(`result missing ${id}`);
      const world = siteWorldPosition(entry.link, entry.site.local);
      expect(world.x).toBeCloseTo(200, 9);
      expect(world.y).toBeCloseTo(50, 9);
    }
  });
});

describe("linkPoseRecipe", () => {
  it("only changes the given fields", () => {
    const crank = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!crank) throw new Error("fixture missing link-2");
    const result = applyRecipes(fourBarFixtureParsed, linkPoseRecipe(crank, { x: 10 }));
    const newCrank = result.links.find((l) => l.id === "link-2");
    expect(newCrank?.pose.position).toEqual([10, 0]);
    expect(newCrank?.pose.angle).toBe(0);
  });

  it("converts angleDeg to radians", () => {
    const crank = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!crank) throw new Error("fixture missing link-2");
    const result = applyRecipes(fourBarFixtureParsed, linkPoseRecipe(crank, { angleDeg: 30 }));
    const newCrank = result.links.find((l) => l.id === "link-2");
    expect(newCrank?.pose.angle).toBeCloseTo(Math.PI / 6, 12);
  });
});

function buildPrismaticFixture(): { doc: MechanismDocument; joint: PrismaticJoint } {
  const doc = applyRecipes(createEmptyDocument(), [
    addLink({
      id: "link-p1",
      name: "p1",
      pose: { position: [0, 0], angle: Math.PI / 4 },
      sites: [{ id: "site-p1", local: [0, 0] }],
    }),
    addLink({
      id: "link-p2",
      name: "p2",
      pose: { position: [3, 3], angle: 0 },
      sites: [{ id: "site-p2", local: [0, 0] }],
    }),
    addJoint({ id: "joint-p", type: "P", siteA: "site-p1", siteB: "site-p2", axis: [1, 0] }),
  ]);
  const joint = doc.joints.find((j) => j.id === "joint-p");
  if (!joint || joint.type !== "P") throw new Error("fixture missing prismatic joint-p");
  return { doc, joint };
}

describe("jointWorldPosition / jointAxisWorldAngleDeg / setJointAxisFromWorldAngleRecipe", () => {
  it("jointWorldPosition returns siteA's world position", () => {
    const { doc, joint } = buildPrismaticFixture();
    const world = jointWorldPosition(doc, joint);
    expect(world.x).toBeCloseTo(0, 12);
    expect(world.y).toBeCloseTo(0, 12);
  });

  it("all three throw CommandError for a joint whose siteA is not in the document (defensive)", () => {
    const { doc, joint } = buildPrismaticFixture();
    const danglingJoint: PrismaticJoint = { ...joint, siteA: "nope" };
    expect(() => jointWorldPosition(doc, danglingJoint)).toThrow(CommandError);
    expect(() => jointAxisWorldAngleDeg(doc, danglingJoint)).toThrow(CommandError);
    expect(() => setJointAxisFromWorldAngleRecipe(doc, danglingJoint, 0)).toThrow(CommandError);
  });

  it("jointAxisWorldAngleDeg rotates the local axis by siteA's link pose", () => {
    const { doc, joint } = buildPrismaticFixture();
    expect(jointAxisWorldAngleDeg(doc, joint)).toBeCloseTo(45, 9);
  });

  it("setJointAxisFromWorldAngleRecipe stores a unit axis whose world angle round-trips", () => {
    const { doc, joint } = buildPrismaticFixture();
    const recipe = setJointAxisFromWorldAngleRecipe(doc, joint, 90);
    const result = applyRecipes(doc, recipe);
    const newJoint = result.joints.find((j) => j.id === "joint-p");
    if (!newJoint || newJoint.type !== "P") throw new Error("result missing joint-p");
    const [ax, ay] = newJoint.axis;
    expect(Math.hypot(ax, ay)).toBeCloseTo(1, 12);
    expect(jointAxisWorldAngleDeg(result, newJoint)).toBeCloseTo(90, 9);
  });
});

describe("markerWorldRecipes", () => {
  it("moves the marker so its world position becomes the given point", () => {
    const marker = fourBarFixtureParsed.markers.find((m) => m.id === "marker-1");
    if (!marker) throw new Error("fixture missing marker-1");
    const recipes = markerWorldRecipes(fourBarFixtureParsed, marker, { x: 100, y: 50 });
    const result = applyRecipes(fourBarFixtureParsed, recipes);
    const newMarker = result.markers.find((m) => m.id === "marker-1");
    if (!newMarker) throw new Error("result missing marker-1");
    // coupler pose is position [40,0], angle 0 in the fixture.
    expect(newMarker.local).toEqual([60, 50]);
  });

  it("throws CommandError for an unknown link", () => {
    const badMarker: Marker = { id: "m", name: "", linkId: "nope", local: [0, 0] };
    expect(() => markerWorldRecipes(fourBarFixtureParsed, badMarker, { x: 0, y: 0 })).toThrow(
      CommandError,
    );
  });
});

describe("motorSpeedDisplay / motorSpeedFromDisplay", () => {
  it("rotary converts rad/s <-> deg/s", () => {
    expect(motorSpeedDisplay("rotary", Math.PI)).toBeCloseTo(180, 12);
    expect(motorSpeedFromDisplay("rotary", 180)).toBeCloseTo(Math.PI, 12);
  });

  it("linear passes the value through unchanged", () => {
    expect(motorSpeedDisplay("linear", 12.5)).toBe(12.5);
    expect(motorSpeedFromDisplay("linear", 12.5)).toBe(12.5);
  });
});

describe("one execute() call = one undo step", () => {
  it("setBarLengthRecipes", () => {
    const store = createMechanismStore({ initialDocument: fourBarFixtureParsed });
    const before = store.getState().document;
    const crank = before.links.find((l) => l.id === "link-2");
    if (!crank) throw new Error("fixture missing link-2");
    store.getState().execute("inspector-length", setBarLengthRecipes(before, crank, 120));
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().document).toEqual(before);
  });

  it("moveSiteClusterRecipes (multi-recipe array)", () => {
    const store = createMechanismStore({ initialDocument: fourBarFixtureParsed });
    const before = store.getState().document;
    store
      .getState()
      .execute("inspector-move", moveSiteClusterRecipes(before, "site-4", { x: 200, y: 50 }));
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().document).toEqual(before);
  });

  it("markerWorldRecipes", () => {
    const store = createMechanismStore({ initialDocument: fourBarFixtureParsed });
    const before = store.getState().document;
    const marker = before.markers.find((m) => m.id === "marker-1");
    if (!marker) throw new Error("fixture missing marker-1");
    store
      .getState()
      .execute("inspector-marker", markerWorldRecipes(before, marker, { x: 5, y: 5 }));
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().document).toEqual(before);
  });

  it("setJointAxisFromWorldAngleRecipe", () => {
    const { doc, joint } = buildPrismaticFixture();
    const store = createMechanismStore({ initialDocument: doc });
    store.getState().execute("inspector-axis", setJointAxisFromWorldAngleRecipe(doc, joint, 90));
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().document).toEqual(doc);
  });
});
