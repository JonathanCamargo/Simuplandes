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
    expect(link?.shape).toEqual({ kind: "bar" });
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
