import { describe, expect, it } from "vitest";
import { produce } from "immer";
import {
  addLink,
  addSite,
  addJoint,
  addMotor,
  addMarker,
  addLoad,
  setLinkPose,
  setSiteLocal,
  setUnits,
  setLinkColor,
  setJointAxis,
  setMotorDrive,
  setMarkerLocal,
  setDocumentName,
  defaultMotorDrive,
  rename,
  moveEntities,
  deleteEntities,
  planDuplicate,
  setPlateOutline,
  setBarEdges,
  addAnnotation,
  clearAnnotations,
  CommandError,
  type Recipe,
} from "./commands";
import {
  MechanismDocumentSchema,
  createEmptyDocument,
  siteWorldPosition,
  degToRad,
  type EntityKind,
  type MechanismDocument,
} from "../model";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";

function applyRecipes(doc: MechanismDocument, recipes: Recipe[]): MechanismDocument {
  return recipes.reduce((acc, recipe) => produce(acc, recipe), doc);
}

function assertNoNegativeZero(value: unknown): void {
  if (typeof value === "number") {
    expect(Object.is(value, -0)).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoNegativeZero);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(assertNoNegativeZero);
  }
}

describe("addLink", () => {
  it("appends a link with defaults: isGround false, identity pose, bar shape, empty site name", () => {
    const base = createEmptyDocument();
    const result = produce(
      base,
      addLink({ id: "link-x", name: "L", sites: [{ id: "site-x", local: [1, 2] }] }),
    );
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
    const link = result.links.find((l) => l.id === "link-x");
    expect(link?.isGround).toBe(false);
    expect(link?.pose).toEqual({ position: [0, 0], angle: 0 });
    expect(link?.shape).toEqual({ kind: "bar", path: ["site-x"] });
    expect(link?.sites[0]).toEqual({ id: "site-x", name: "", local: [1, 2] });
  });

  it("throws CommandError on a duplicate id, of any entity kind", () => {
    expect(() =>
      produce(fourBarFixtureParsed, addLink({ id: "site-1", name: "dup", sites: [] })),
    ).toThrow(CommandError);
    expect(() =>
      produce(fourBarFixtureParsed, addLink({ id: "motor-1", name: "dup", sites: [] })),
    ).toThrow(CommandError);
  });
});

describe("addSite", () => {
  it("appends to the given link", () => {
    const result = produce(
      fourBarFixtureParsed,
      addSite("link-1", { id: "site-new", local: [5, 5] }),
    );
    const link = result.links.find((l) => l.id === "link-1");
    expect(link?.sites.some((s) => s.id === "site-new")).toBe(true);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("throws CommandError on an unknown linkId", () => {
    expect(() =>
      produce(fourBarFixtureParsed, addSite("link-nope", { id: "site-new", local: [0, 0] })),
    ).toThrow(CommandError);
  });
});

describe("addJoint", () => {
  it("throws CommandError on an unknown site (R)", () => {
    expect(() =>
      produce(
        fourBarFixtureParsed,
        addJoint({ id: "joint-x", type: "R", siteA: "site-1", siteB: "nope" }),
      ),
    ).toThrow(CommandError);
  });

  it("throws CommandError when both sites are on the same link", () => {
    expect(() =>
      produce(
        fourBarFixtureParsed,
        addJoint({ id: "joint-x", type: "R", siteA: "site-1", siteB: "site-2" }),
      ),
    ).toThrow(CommandError);
  });

  it("throws CommandError for a P joint with a zero axis", () => {
    const base = applyRecipes(fourBarFixtureParsed, [
      addLink({
        id: "link-x",
        name: "x",
        sites: [
          { id: "site-x1", local: [0, 0] },
          { id: "site-x2", local: [1, 0] },
        ],
      }),
    ]);
    expect(() =>
      produce(
        base,
        addJoint({ id: "joint-x", type: "P", siteA: "site-1", siteB: "site-x1", axis: [0, 0] }),
      ),
    ).toThrow(CommandError);
  });

  it("adds a valid P joint with a non-zero axis", () => {
    const base = applyRecipes(fourBarFixtureParsed, [
      addLink({
        id: "link-x",
        name: "x",
        sites: [
          { id: "site-x1", local: [0, 0] },
          { id: "site-x2", local: [1, 0] },
        ],
      }),
    ]);
    const result = produce(
      base,
      addJoint({ id: "joint-x", type: "P", siteA: "site-1", siteB: "site-x1", axis: [1, 0] }),
    );
    expect(result.joints.some((j) => j.id === "joint-x")).toBe(true);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });
});

describe("addMotor", () => {
  it("infers rotary from an R joint and defaults drive to constant speed 1", () => {
    const result = produce(fourBarFixtureParsed, addMotor({ id: "motor-x", jointId: "joint-2" }));
    const motor = result.motors.find((m) => m.id === "motor-x");
    expect(motor?.kind).toBe("rotary");
    expect(motor?.drive).toEqual({ mode: "constant", speed: 1 });
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("infers linear from a P joint", () => {
    const base = applyRecipes(fourBarFixtureParsed, [
      addLink({
        id: "link-x",
        name: "x",
        sites: [
          { id: "site-x1", local: [0, 0] },
          { id: "site-x2", local: [1, 0] },
        ],
      }),
      addJoint({ id: "joint-p", type: "P", siteA: "site-1", siteB: "site-x1", axis: [1, 0] }),
    ]);
    const result = produce(base, addMotor({ id: "motor-p", jointId: "joint-p" }));
    const motor = result.motors.find((m) => m.id === "motor-p");
    expect(motor?.kind).toBe("linear");
  });

  it("throws CommandError when the joint already has a motor", () => {
    expect(() =>
      produce(fourBarFixtureParsed, addMotor({ id: "motor-x", jointId: "joint-1" })),
    ).toThrow(CommandError);
  });
});

describe("addMarker / addLoad", () => {
  it("addMarker validates linkId", () => {
    expect(() =>
      produce(fourBarFixtureParsed, addMarker({ id: "marker-x", linkId: "nope", local: [0, 0] })),
    ).toThrow(CommandError);
    const result = produce(
      fourBarFixtureParsed,
      addMarker({ id: "marker-x", linkId: "link-1", local: [1, 1] }),
    );
    expect(result.markers.some((m) => m.id === "marker-x")).toBe(true);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("addLoad validates siteId", () => {
    expect(() => produce(fourBarFixtureParsed, addLoad({ id: "load-x", siteId: "nope" }))).toThrow(
      CommandError,
    );
    const result = produce(fourBarFixtureParsed, addLoad({ id: "load-x", siteId: "site-1" }));
    expect(result.loads.some((l) => l.id === "load-x")).toBe(true);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });
});

describe("setLinkPose / setSiteLocal / setUnits / rename", () => {
  it("setLinkPose updates the link's pose; unknown id throws", () => {
    const result = produce(
      fourBarFixtureParsed,
      setLinkPose("link-2", { position: [10, 20], angle: 0.5 }),
    );
    const link = result.links.find((l) => l.id === "link-2");
    expect(link?.pose).toEqual({ position: [10, 20], angle: 0.5 });
    expect(() =>
      produce(fourBarFixtureParsed, setLinkPose("nope", { position: [0, 0], angle: 0 })),
    ).toThrow(CommandError);
  });

  it("setSiteLocal updates the site's local coords; unknown id throws", () => {
    const result = produce(fourBarFixtureParsed, setSiteLocal("site-3", [7, 8]));
    const link = result.links.find((l) => l.id === "link-2");
    expect(link?.sites.find((s) => s.id === "site-3")?.local).toEqual([7, 8]);
    expect(() => produce(fourBarFixtureParsed, setSiteLocal("nope", [0, 0]))).toThrow(CommandError);
  });

  it("setUnits changes the label only; no coordinate changes", () => {
    const result = produce(fourBarFixtureParsed, setUnits("m"));
    expect(result.units.length).toBe("m");
    expect(result.links).toEqual(fourBarFixtureParsed.links);
  });

  it("rename works for any named entity kind; unknown id throws", () => {
    expect(
      produce(fourBarFixtureParsed, rename("link-2", "Crank")).links.find((l) => l.id === "link-2")
        ?.name,
    ).toBe("Crank");
    expect(
      produce(fourBarFixtureParsed, rename("site-3", "A"))
        .links.flatMap((l) => l.sites)
        .find((s) => s.id === "site-3")?.name,
    ).toBe("A");
    expect(
      produce(fourBarFixtureParsed, rename("joint-1", "J1")).joints.find((j) => j.id === "joint-1")
        ?.name,
    ).toBe("J1");
    expect(
      produce(fourBarFixtureParsed, rename("motor-1", "M1")).motors.find((m) => m.id === "motor-1")
        ?.name,
    ).toBe("M1");
    expect(
      produce(fourBarFixtureParsed, rename("marker-1", "Trace")).markers.find(
        (m) => m.id === "marker-1",
      )?.name,
    ).toBe("Trace");
    expect(
      produce(fourBarFixtureParsed, rename("load-1", "Weight")).loads.find((l) => l.id === "load-1")
        ?.name,
    ).toBe("Weight");
    expect(() => produce(fourBarFixtureParsed, rename("nope", "x"))).toThrow(CommandError);
  });
});

describe("moveEntities", () => {
  it("moves a selected link's pose.position by the world delta, leaving its sites' local unchanged", () => {
    const before = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!before) throw new Error("fixture missing link-2");
    const beforeSites = before.sites.map((s) => s.local);
    const result = produce(
      fourBarFixtureParsed,
      moveEntities(new Set(["link-2"]), { x: 10, y: 5 }),
    );
    const after = result.links.find((l) => l.id === "link-2");
    if (!after) throw new Error("result missing link-2");
    expect(after.pose.position).toEqual([
      before.pose.position[0] + 10,
      before.pose.position[1] + 5,
    ]);
    expect(after.sites.map((s) => s.local)).toEqual(beforeSites);
  });

  it("rotates the world delta into link-local for a selected site on an unselected link", () => {
    const base = applyRecipes(createEmptyDocument(), [
      addLink({
        id: "link-r",
        name: "r",
        pose: { position: [0, 0], angle: Math.PI / 2 },
        sites: [{ id: "site-r", local: [0, 0] }],
      }),
    ]);
    const result = produce(base, moveEntities(new Set(["site-r"]), { x: 10, y: 5 }));
    const link = result.links.find((l) => l.id === "link-r");
    if (!link) throw new Error("result missing link-r");
    const site = link.sites[0];
    expect(site.local[0]).toBeCloseTo(5, 9);
    expect(site.local[1]).toBeCloseTo(-10, 9);
    const worldAfter = siteWorldPosition(link, site.local);
    expect(worldAfter.x).toBeCloseTo(10, 9);
    expect(worldAfter.y).toBeCloseTo(5, 9);
  });

  it("does not double-move a site whose link is also selected", () => {
    const before = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!before) throw new Error("fixture missing link-2");
    const result = produce(
      fourBarFixtureParsed,
      moveEntities(new Set(["link-2", "site-3", "site-4"]), { x: 10, y: 5 }),
    );
    const link = result.links.find((l) => l.id === "link-2");
    if (!link) throw new Error("result missing link-2");
    expect(link.sites.map((s) => s.local)).toEqual(before.sites.map((s) => s.local));
    expect(link.pose.position).toEqual([before.pose.position[0] + 10, before.pose.position[1] + 5]);
  });

  it("applies the same rotation rule to a selected marker whose link is not selected", () => {
    const base = applyRecipes(createEmptyDocument(), [
      addLink({
        id: "link-m",
        name: "m",
        pose: { position: [0, 0], angle: Math.PI / 2 },
        sites: [{ id: "site-m", local: [0, 0] }],
      }),
      addMarker({ id: "marker-m", linkId: "link-m", local: [0, 0] }),
    ]);
    const result = produce(base, moveEntities(new Set(["marker-m"]), { x: 10, y: 5 }));
    const marker = result.markers.find((m) => m.id === "marker-m");
    if (!marker) throw new Error("result missing marker-m");
    expect(marker.local[0]).toBeCloseTo(5, 9);
    expect(marker.local[1]).toBeCloseTo(-10, 9);
  });

  it("positive dy moves up (y-up)", () => {
    const before = fourBarFixtureParsed.links.find((l) => l.id === "link-2");
    if (!before) throw new Error("fixture missing link-2");
    const result = produce(fourBarFixtureParsed, moveEntities(new Set(["link-2"]), { x: 0, y: 5 }));
    const after = result.links.find((l) => l.id === "link-2");
    expect(after?.pose.position[1]).toBeGreaterThan(before.pose.position[1]);
  });

  it("ignores unknown ids", () => {
    const result = produce(fourBarFixtureParsed, moveEntities(new Set(["nope"]), { x: 1, y: 1 }));
    expect(result).toEqual(fourBarFixtureParsed);
  });

  it("never leaves -0 in the result", () => {
    const base = applyRecipes(createEmptyDocument(), [
      addLink({
        id: "link-r",
        name: "r",
        pose: { position: [0, 0], angle: Math.PI },
        sites: [{ id: "site-r", local: [0, 0] }],
      }),
    ]);
    const result = produce(base, moveEntities(new Set(["link-r", "site-r"]), { x: 0, y: 0 }));
    assertNoNegativeZero(result);
  });
});

describe("deleteEntities cascade", () => {
  it("deleteEntities([linkId]) cascades to sites, touching joints, their motors, and stays schema-valid", () => {
    const result = produce(fourBarFixtureParsed, deleteEntities(new Set(["link-1"])));
    expect(result.links.some((l) => l.id === "link-1")).toBe(false);
    const remainingSiteIds = new Set(result.links.flatMap((l) => l.sites.map((s) => s.id)));
    expect(remainingSiteIds.has("site-1")).toBe(false);
    expect(remainingSiteIds.has("site-2")).toBe(false);
    expect(result.joints.some((j) => j.id === "joint-1")).toBe(false);
    expect(result.joints.some((j) => j.id === "joint-4")).toBe(false);
    expect(result.motors.some((m) => m.id === "motor-1")).toBe(false);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("deleteEntities([linkId]) also removes markers on that link", () => {
    const base = applyRecipes(fourBarFixtureParsed, [
      addMarker({ id: "marker-x", linkId: "link-2", local: [0, 0] }),
    ]);
    const result = produce(base, deleteEntities(new Set(["link-2"])));
    expect(result.markers.some((m) => m.id === "marker-x")).toBe(false);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("deleteEntities([siteId]) removes the site plus its joints/motors/loads", () => {
    const result = produce(fourBarFixtureParsed, deleteEntities(new Set(["site-6"])));
    const link3 = result.links.find((l) => l.id === "link-3");
    expect(link3?.sites.some((s) => s.id === "site-6")).toBe(false);
    expect(result.joints.some((j) => j.id === "joint-3")).toBe(false);
    expect(result.loads.some((l) => l.id === "load-1")).toBe(false);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("deleteEntities([jointId]) removes the joint and its motor", () => {
    const result = produce(fourBarFixtureParsed, deleteEntities(new Set(["joint-1"])));
    expect(result.joints.some((j) => j.id === "joint-1")).toBe(false);
    expect(result.motors.some((m) => m.id === "motor-1")).toBe(false);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });
});

describe("setLinkColor", () => {
  it("sets a valid #RRGGBB color", () => {
    const result = produce(fourBarFixtureParsed, setLinkColor("link-2", "#112233"));
    expect(result.links.find((l) => l.id === "link-2")?.color).toBe("#112233");
  });

  it("undefined deletes the color property entirely", () => {
    const withColor = produce(fourBarFixtureParsed, setLinkColor("link-2", "#112233"));
    const result = produce(withColor, setLinkColor("link-2", undefined));
    const link = result.links.find((l) => l.id === "link-2");
    expect(link).toBeDefined();
    expect(link && "color" in link).toBe(false);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("throws CommandError for a non-#RRGGBB string, without mutating the draft", () => {
    expect(() => produce(fourBarFixtureParsed, setLinkColor("link-2", "red"))).toThrow(
      CommandError,
    );
    expect(() => produce(fourBarFixtureParsed, setLinkColor("link-2", "#fff"))).toThrow(
      CommandError,
    );
  });

  it("throws CommandError for an unknown link", () => {
    expect(() => produce(fourBarFixtureParsed, setLinkColor("nope", "#112233"))).toThrow(
      CommandError,
    );
  });
});

describe("setJointAxis", () => {
  const withPJoint = (): MechanismDocument =>
    applyRecipes(fourBarFixtureParsed, [
      addLink({
        id: "link-x",
        name: "x",
        sites: [
          { id: "site-x1", local: [0, 0] },
          { id: "site-x2", local: [1, 0] },
        ],
      }),
      addJoint({ id: "joint-p", type: "P", siteA: "site-1", siteB: "site-x1", axis: [1, 0] }),
    ]);

  it("stores the axis on a P joint", () => {
    const base = withPJoint();
    const result = produce(base, setJointAxis("joint-p", [0, 2]));
    const joint = result.joints.find((j) => j.id === "joint-p");
    expect(joint?.type === "P" && joint.axis).toEqual([0, 2]);
  });

  it("throws CommandError on an R joint", () => {
    expect(() => produce(fourBarFixtureParsed, setJointAxis("joint-1", [1, 0]))).toThrow(
      CommandError,
    );
  });

  it("throws CommandError on a zero axis", () => {
    const base = withPJoint();
    expect(() => produce(base, setJointAxis("joint-p", [0, 0]))).toThrow(CommandError);
  });

  it("throws CommandError on an unknown joint", () => {
    expect(() => produce(fourBarFixtureParsed, setJointAxis("nope", [1, 0]))).toThrow(CommandError);
  });
});

describe("setMotorDrive", () => {
  it("replaces a constant drive", () => {
    const result = produce(
      fourBarFixtureParsed,
      setMotorDrive("motor-1", { mode: "constant", speed: 2 }),
    );
    expect(result.motors.find((m) => m.id === "motor-1")?.drive).toEqual({
      mode: "constant",
      speed: 2,
    });
  });

  it("replaces with a valid expression drive", () => {
    const result = produce(
      fourBarFixtureParsed,
      setMotorDrive("motor-1", { mode: "expression", expression: "sin(t)" }),
    );
    expect(result.motors.find((m) => m.id === "motor-1")?.drive).toEqual({
      mode: "expression",
      expression: "sin(t)",
    });
  });

  it("throws CommandError for an expression drive with an empty string", () => {
    expect(() =>
      produce(
        fourBarFixtureParsed,
        setMotorDrive("motor-1", { mode: "expression", expression: "" }),
      ),
    ).toThrow(CommandError);
  });

  it("throws CommandError for an unknown motor", () => {
    expect(() =>
      produce(fourBarFixtureParsed, setMotorDrive("nope", { mode: "constant", speed: 1 })),
    ).toThrow(CommandError);
  });
});

describe("setMarkerLocal / setDocumentName", () => {
  it("setMarkerLocal updates the marker's local coords; unknown id throws", () => {
    const result = produce(fourBarFixtureParsed, setMarkerLocal("marker-1", [3, 4]));
    expect(result.markers.find((m) => m.id === "marker-1")?.local).toEqual([3, 4]);
    expect(() => produce(fourBarFixtureParsed, setMarkerLocal("nope", [0, 0]))).toThrow(
      CommandError,
    );
  });

  it("setDocumentName updates the document's name", () => {
    const result = produce(fourBarFixtureParsed, setDocumentName("New name"));
    expect(result.name).toBe("New name");
  });
});

describe("defaultMotorDrive", () => {
  it("rotary defaults to 36 deg/s, stored as rad/s", () => {
    const drive = defaultMotorDrive("rotary");
    expect(drive).toEqual({ mode: "constant", speed: degToRad(36) });
  });

  it("linear defaults to 10 units/s", () => {
    expect(defaultMotorDrive("linear")).toEqual({ mode: "constant", speed: 10 });
  });
});

describe("planDuplicate", () => {
  function makeIdFactory(): (kind: EntityKind) => string {
    const counters: Partial<Record<EntityKind, number>> = {};
    return (kind) => {
      counters[kind] = (counters[kind] ?? 0) + 1;
      return `${kind}-dup-${counters[kind]}`;
    };
  }

  it("duplicates the crank+coupler: 2 new links, the internal R joint, the coupler's marker; O2/B are not copied; schema-valid", () => {
    const idFactory = makeIdFactory();
    const { recipe, newLinkIds, idMap } = planDuplicate(
      fourBarFixtureParsed,
      new Set(["link-2", "link-3"]),
      { x: 10, y: -10 },
      idFactory,
    );

    expect(newLinkIds).toHaveLength(2);

    const next = produce(fourBarFixtureParsed, recipe);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);

    // Original document (4 links, 4 joints, 1 motor, 1 marker) + 2 new links,
    // 1 new (internal) joint, 0 new motors (its only motor is on joint-1,
    // which touches ground -- not internal), 1 new marker.
    expect(next.links).toHaveLength(6);
    expect(next.joints).toHaveLength(5);
    expect(next.motors).toHaveLength(1);
    expect(next.markers).toHaveLength(2);

    const newCrank = next.links.find((l) => l.id === idMap.get("link-2"));
    const newCoupler = next.links.find((l) => l.id === idMap.get("link-3"));
    expect(newCrank).toBeDefined();
    expect(newCoupler).toBeDefined();
    expect(newCrank?.pose.position).toEqual([10, -10]);
    expect(newCoupler?.pose.position).toEqual([50, -10]);
    expect(newCrank?.isGround).toBe(false);

    // The only internal joint is joint-2 (site-4 on the crank <-> site-5 on
    // the coupler); joint-1 (ground<->crank, "O2") and joint-3
    // (coupler<->rocker, "B") are NOT duplicated (the rocker/ground weren't).
    const newSiteA = idMap.get("site-4");
    const newSiteB = idMap.get("site-5");
    const copiedJoint = next.joints.find((j) => j.siteA === newSiteA && j.siteB === newSiteB);
    expect(copiedJoint).toBeDefined();
    expect(copiedJoint?.type).toBe("R");
    expect(idMap.has("joint-1")).toBe(false);
    expect(idMap.has("joint-3")).toBe(false);
    expect(idMap.has("motor-1")).toBe(false);

    const newMarker = next.markers.find((m) => m.linkId === idMap.get("link-3"));
    expect(newMarker).toBeDefined();
    expect(newMarker?.local).toEqual([25, 0]);
  });

  it("never duplicates the ground link even if its id is in `ids`", () => {
    const idFactory = makeIdFactory();
    const { recipe, newLinkIds } = planDuplicate(
      fourBarFixtureParsed,
      new Set(["link-1", "link-2"]),
      { x: 0, y: 0 },
      idFactory,
    );
    expect(newLinkIds).toHaveLength(1);
    const next = produce(fourBarFixtureParsed, recipe);
    expect(next.links.filter((l) => l.isGround)).toHaveLength(1);
  });

  it("mints every id up front via `newId`, never reusing the source ids", () => {
    const idFactory = makeIdFactory();
    const { newLinkIds } = planDuplicate(
      fourBarFixtureParsed,
      new Set(["link-2"]),
      { x: 5, y: 5 },
      idFactory,
    );
    expect(newLinkIds[0]).toBe("link-dup-1");
  });
});

describe("bar path", () => {
  const crankPath = (doc: MechanismDocument, linkId = "link-2") => {
    const shape = doc.links.find((l) => l.id === linkId)!.shape;
    return shape.kind === "bar" ? shape.path : null;
  };

  it("addLink rejects a path naming a foreign or repeated site", () => {
    const sites = [
      { id: "a", local: [0, 0] as [number, number] },
      { id: "b", local: [1, 0] as [number, number] },
    ];
    const bad = (path: string[]) =>
      produce(
        createEmptyDocument(),
        addLink({ id: "l", name: "", shape: { kind: "bar", path }, sites }),
      );
    expect(() => bad(["a", "zz"])).toThrow(CommandError);
    expect(() => bad(["a", "a"])).toThrow(CommandError);
    expect(crankPath(bad(["b"]), "l")).toEqual(["b"]);
  });

  it("addSite keeps a new site off the path unless onPath is set", () => {
    const next = applyRecipes(fourBarFixtureParsed, [
      addSite("link-2", { id: "site-off", local: [20, 0] }),
      addSite("link-2", { id: "site-on", local: [60, 0] }, { onPath: true }),
    ]);
    expect(crankPath(next)).toEqual(["site-3", "site-4", "site-on"]);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);
  });

  it("deleteEntities drops a deleted site from the path", () => {
    const next = produce(fourBarFixtureParsed, deleteEntities(new Set(["site-4"])));
    expect(crankPath(next)).toEqual(["site-3"]);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);
  });

  it("planDuplicate maps the path to the copy's site ids", () => {
    let n = 0;
    const { recipe, idMap } = planDuplicate(
      fourBarFixtureParsed,
      new Set(["link-2"]),
      { x: 0, y: 0 },
      (kind) => `${kind}-copy-${++n}`,
    );
    const next = produce(fourBarFixtureParsed, recipe);
    expect(crankPath(next, idMap.get("link-2"))).toEqual([
      idMap.get("site-3"),
      idMap.get("site-4"),
    ]);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);
  });
});

describe("setPlateOutline", () => {
  it("replaces a plate's outline and stays schema-valid", () => {
    const outline: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 8],
    ];
    const next = produce(fourBarFixtureParsed, setPlateOutline("link-3", outline, undefined));
    const shape = next.links.find((l) => l.id === "link-3")!.shape;
    expect(shape).toEqual({ kind: "plate", outline });
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);
  });

  it("rejects a bar, an unknown link, fewer than 3 vertices or a non-finite one", () => {
    const tri: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const run = (id: string, outline: [number, number][]) =>
      produce(fourBarFixtureParsed, setPlateOutline(id, outline, undefined));
    expect(() => run("link-2", tri)).toThrow(CommandError);
    expect(() => run("nope", tri)).toThrow(CommandError);
    expect(() => run("link-3", tri.slice(0, 2))).toThrow(CommandError);
    expect(() => run("link-3", [...tri.slice(0, 2), [Number.NaN, 0]])).toThrow(CommandError);
  });
});

describe("curved edges", () => {
  const arc = { kind: "arc" as const, bulge: 0.5 };
  const line = { kind: "line" as const };
  const crankEdges = (doc: MechanismDocument) =>
    doc.links.find((l) => l.id === "link-2")!.shape.edges;

  it("setBarEdges sets one edge per path segment, and undefined straightens", () => {
    const curved = produce(fourBarFixtureParsed, setBarEdges("link-2", [arc]));
    expect(crankEdges(curved)).toEqual([arc]);
    expect(MechanismDocumentSchema.safeParse(curved).success).toBe(true);
    expect(crankEdges(produce(curved, setBarEdges("link-2", undefined)))).toBeUndefined();
    expect(() => produce(fourBarFixtureParsed, setBarEdges("link-2", [arc, arc]))).toThrow(
      CommandError,
    );
    expect(() => produce(fourBarFixtureParsed, setBarEdges("link-3", [arc]))).toThrow(CommandError);
    expect(() =>
      produce(fourBarFixtureParsed, setBarEdges("link-2", [{ kind: "arc", bulge: 99 }])),
    ).toThrow(CommandError);
  });

  it("an added path site gets a straight edge; deleting a path site keeps surviving curves", () => {
    const next = applyRecipes(fourBarFixtureParsed, [
      setBarEdges("link-2", [arc]),
      addSite("link-2", { id: "site-tip", local: [80, 0] }, { onPath: true }),
    ]);
    expect(crankEdges(next)).toEqual([arc, line]);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);

    const trimmed = produce(next, deleteEntities(new Set(["site-tip"])));
    expect(crankEdges(trimmed)).toEqual([arc]);
    const middle = produce(next, deleteEntities(new Set(["site-4"])));
    expect(crankEdges(middle)).toEqual([line]);
    expect(MechanismDocumentSchema.safeParse(middle).success).toBe(true);
  });

  it("setPlateOutline checks the edge count; duplicating keeps curves", () => {
    const outline: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 8],
    ];
    const next = produce(
      fourBarFixtureParsed,
      setPlateOutline("link-3", outline, [arc, line, line]),
    );
    expect(next.links.find((l) => l.id === "link-3")!.shape.edges).toEqual([arc, line, line]);
    expect(() => produce(fourBarFixtureParsed, setPlateOutline("link-3", outline, [arc]))).toThrow(
      CommandError,
    );

    let n = 0;
    const curved = produce(fourBarFixtureParsed, setBarEdges("link-2", [arc]));
    const { recipe, idMap } = planDuplicate(
      curved,
      new Set(["link-2"]),
      { x: 0, y: 0 },
      (kind) => `${kind}-c-${++n}`,
    );
    const copy = produce(curved, recipe).links.find((l) => l.id === idMap.get("link-2"))!;
    expect(copy.shape.edges).toEqual([arc]);
  });
});

describe("annotations", () => {
  const stroke = {
    id: "note-1",
    points: [
      [0, 0],
      [10, 5],
    ] as [number, number][],
    color: "blue" as const,
    width: 2,
  };

  it("addAnnotation adds a schema-valid stroke; deleteEntities and clearAnnotations remove them", () => {
    const next = produce(fourBarFixtureParsed, addAnnotation(stroke));
    expect(next.annotations).toEqual([{ ...stroke, kind: "stroke" }]);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);
    expect(produce(next, deleteEntities(new Set(["note-1"]))).annotations).toEqual([]);
    expect(produce(next, clearAnnotations()).annotations).toEqual([]);
    // Deleting a link leaves annotations alone.
    expect(produce(next, deleteEntities(new Set(["link-2"]))).annotations).toHaveLength(1);
  });

  it("rejects a duplicate id, no points, non-finite points or a bad width", () => {
    const run = (input: typeof stroke) => produce(fourBarFixtureParsed, addAnnotation(input));
    expect(() => run({ ...stroke, id: "link-1" })).toThrow(CommandError);
    expect(() => run({ ...stroke, points: [] })).toThrow(CommandError);
    expect(() => run({ ...stroke, points: [[0, Number.NaN]] })).toThrow(CommandError);
    expect(() => run({ ...stroke, width: 0 })).toThrow(CommandError);
  });
});

describe("deleteEntities: attachment sites", () => {
  /**
   * Bar A (path a1-a2) with an attachment site `ax` in its middle pinned to
   * bar B's end `b1`; plate P with a corner site `pc` and an interior site
   * `pi` pinned to `b2`; a ground pivot `g1` pinned to `a1`.
   */
  function base(): MechanismDocument {
    return applyRecipes(MechanismDocumentSchema.parse({ schemaVersion: 2 }), [
      addLink({
        id: "A",
        name: "A",
        sites: [
          { id: "a1", local: [0, 0] },
          { id: "a2", local: [100, 0] },
        ],
      }),
      addSite("A", { id: "ax", local: [50, 0] }),
      addLink({
        id: "B",
        name: "B",
        sites: [
          { id: "b1", local: [50, 0] },
          { id: "b2", local: [50, 80] },
        ],
      }),
      addLink({
        id: "P",
        name: "P",
        shape: {
          kind: "plate",
          outline: [
            [40, 70],
            [60, 70],
            [60, 90],
          ],
        },
        sites: [
          { id: "pc", local: [40, 70] },
          { id: "pi", local: [55, 78] },
        ],
      }),
      addLink({ id: "G", name: "Ground", isGround: true, sites: [{ id: "g1", local: [0, 0] }] }),
      addJoint({ id: "jA", type: "R", siteA: "ax", siteB: "b1" }),
      addJoint({ id: "jP", type: "R", siteA: "pi", siteB: "b2" }),
      addJoint({ id: "jC", type: "R", siteA: "pc", siteB: "b2" }),
      addJoint({ id: "jG", type: "R", siteA: "g1", siteB: "a1" }),
    ]);
  }

  function siteIds(doc: MechanismDocument): Set<string> {
    return new Set(doc.links.flatMap((l) => l.sites.map((s) => s.id)));
  }

  it("deleting a pin on a bar's middle removes the point it added, not the bar's ends", () => {
    const result = produce(base(), deleteEntities(new Set(["jA"])));
    const ids = siteIds(result);
    expect(ids.has("ax")).toBe(false);
    expect(ids.has("b1")).toBe(true);
    expect(ids.has("a1")).toBe(true);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("deleting a pin removes a plate's interior point but keeps its corners", () => {
    const interior = produce(base(), deleteEntities(new Set(["jP"])));
    expect(siteIds(interior).has("pi")).toBe(false);
    const corner = produce(base(), deleteEntities(new Set(["jC"])));
    expect(siteIds(corner).has("pc")).toBe(true);
  });

  it("deleting a link removes the points its joints had added on other links", () => {
    const result = produce(base(), deleteEntities(new Set(["B"])));
    const ids = siteIds(result);
    expect(ids.has("ax")).toBe(false);
    expect(ids.has("pi")).toBe(false);
    expect(ids.has("pc")).toBe(true);
    expect(result.joints.map((j) => j.id)).toEqual(["jG"]);
    expect(MechanismDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("keeps a ground pivot, and a point something else still uses", () => {
    const grounded = produce(base(), deleteEntities(new Set(["jG"])));
    expect(siteIds(grounded).has("g1")).toBe(true);

    const withLoad = applyRecipes(base(), [addLoad({ id: "L", siteId: "ax", force: [0, -1] })]);
    const loaded = produce(withLoad, deleteEntities(new Set(["jA"])));
    expect(siteIds(loaded).has("ax")).toBe(true);
    expect(loaded.loads).toHaveLength(1);

    const twice = applyRecipes(base(), [
      addJoint({ id: "jA2", type: "R", siteA: "ax", siteB: "pc" }),
    ]);
    const shared = produce(twice, deleteEntities(new Set(["jA"])));
    expect(siteIds(shared).has("ax")).toBe(true);
  });
});
