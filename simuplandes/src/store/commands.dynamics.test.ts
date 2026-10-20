import { describe, expect, it } from "vitest";
import { produce } from "immer";
import {
  addLink,
  addSpring,
  deleteEntities,
  planDuplicate,
  rename,
  setDynamicsSettings,
  setLinkMassProperties,
  setLoad,
  setMotorDynamics,
  setSpringParameters,
  CommandError,
  type Recipe,
} from "./commands";
import { MechanismDocumentSchema, type EntityKind, type MechanismDocument } from "../model";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";

const base = fourBarFixtureParsed;

function apply(doc: MechanismDocument, ...recipes: Recipe[]): MechanismDocument {
  return recipes.reduce((acc, recipe) => produce(acc, recipe), doc);
}

const linear = addSpring({
  id: "spring-1",
  kind: "linear",
  siteA: "site-2",
  siteB: "site-6",
  stiffness: 100,
  freeLength: 60,
});
const torsional = addSpring({
  id: "spring-2",
  kind: "torsional",
  jointId: "joint-3",
  stiffness: 2,
});

describe("addSpring", () => {
  it("adds linear and torsional springs with defaults", () => {
    const doc = apply(base, linear, torsional);
    expect(doc.springs).toEqual([
      {
        id: "spring-1",
        name: "",
        kind: "linear",
        siteA: "site-2",
        siteB: "site-6",
        stiffness: 100,
        damping: 0,
        freeLength: 60,
      },
      {
        id: "spring-2",
        name: "",
        kind: "torsional",
        jointId: "joint-3",
        stiffness: 2,
        damping: 0,
        freeAngle: 0,
      },
    ]);
    expect(MechanismDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects bad input before mutating", () => {
    const cases: Recipe[] = [
      addSpring({ id: "joint-1", kind: "torsional", jointId: "joint-1", stiffness: 1 }),
      addSpring({ id: "s", kind: "torsional", jointId: "nope", stiffness: 1 }),
      addSpring({ id: "s", kind: "torsional", jointId: "joint-1", stiffness: -1 }),
      addSpring({ id: "s", kind: "torsional", jointId: "joint-1", stiffness: 1, damping: -1 }),
      addSpring({ id: "s", kind: "torsional", jointId: "joint-1", stiffness: 1, freeAngle: NaN }),
      addSpring({
        id: "s",
        kind: "linear",
        siteA: "x",
        siteB: "site-6",
        stiffness: 1,
        freeLength: 1,
      }),
      addSpring({
        id: "s",
        kind: "linear",
        siteA: "site-2",
        siteB: "x",
        stiffness: 1,
        freeLength: 1,
      }),
      addSpring({
        id: "s",
        kind: "linear",
        siteA: "site-3",
        siteB: "site-4",
        stiffness: 1,
        freeLength: 1,
      }),
      addSpring({
        id: "s",
        kind: "linear",
        siteA: "site-2",
        siteB: "site-6",
        stiffness: 1,
        freeLength: -1,
      }),
    ];
    for (const recipe of cases) expect(() => apply(base, recipe)).toThrow(CommandError);
  });

  it("rejects a torsional spring on a prismatic joint", () => {
    const doc = MechanismDocumentSchema.parse({
      ...base,
      joints: [{ id: "joint-p", type: "P", siteA: "site-1", siteB: "site-3", axis: [1, 0] }],
      motors: [],
    });
    expect(() =>
      apply(doc, addSpring({ id: "s", kind: "torsional", jointId: "joint-p", stiffness: 1 })),
    ).toThrow(/R joint/);
  });
});

describe("setSpringParameters", () => {
  it("edits the numbers each kind has", () => {
    const doc = apply(
      base,
      linear,
      torsional,
      setSpringParameters("spring-1", { stiffness: 5, damping: 1, freeLength: 10 }),
      setSpringParameters("spring-2", { freeAngle: 0.5 }),
    );
    expect(doc.springs[0]).toMatchObject({ stiffness: 5, damping: 1, freeLength: 10 });
    expect(doc.springs[1]).toMatchObject({ freeAngle: 0.5, stiffness: 2 });
  });

  it("rejects unknown springs, negative values and the wrong kind of parameter", () => {
    const doc = apply(base, linear, torsional);
    const cases: Recipe[] = [
      setSpringParameters("nope", { stiffness: 1 }),
      setSpringParameters("spring-1", { stiffness: -1 }),
      setSpringParameters("spring-1", { damping: -1 }),
      setSpringParameters("spring-1", { freeLength: -1 }),
      setSpringParameters("spring-1", { freeAngle: 1 }),
      setSpringParameters("spring-2", { freeLength: 1 }),
      setSpringParameters("spring-2", { freeAngle: Infinity }),
    ];
    for (const recipe of cases) expect(() => apply(doc, recipe)).toThrow(CommandError);
  });

  it("renames a spring", () => {
    expect(apply(base, linear, rename("spring-1", "k1")).springs[0].name).toBe("k1");
  });
});

describe("setLinkMassProperties", () => {
  it("sets and clears authored mass properties", () => {
    const set = apply(
      base,
      setLinkMassProperties("link-2", { mass: 1, com: [-0, 2], inertia: 0.1 }),
    );
    expect(set.links[1].massProperties).toEqual({ mass: 1, com: [0, 2], inertia: 0.1 });
    expect(Object.is(set.links[1].massProperties!.com[0], -0)).toBe(false);
    const cleared = apply(set, setLinkMassProperties("link-2", undefined));
    expect("massProperties" in cleared.links[1]).toBe(false);
  });

  it("rejects an unknown link and bad values", () => {
    const cases: Recipe[] = [
      setLinkMassProperties("nope", undefined),
      setLinkMassProperties("link-2", { mass: -1, com: [0, 0], inertia: 0 }),
      setLinkMassProperties("link-2", { mass: 1, com: [0, 0], inertia: -1 }),
      setLinkMassProperties("link-2", { mass: 1, com: [NaN, 0], inertia: 0 }),
    ];
    for (const recipe of cases) expect(() => apply(base, recipe)).toThrow(CommandError);
  });

  it("is carried by addLink", () => {
    const doc = apply(
      base,
      addLink({
        id: "link-x",
        name: "x",
        sites: [],
        massProperties: { mass: 2, com: [1, 1], inertia: 3 },
      }),
    );
    expect(doc.links[4].massProperties).toEqual({ mass: 2, com: [1, 1], inertia: 3 });
  });
});

describe("setDynamicsSettings", () => {
  it("edits gravity and densities", () => {
    const doc = apply(
      base,
      setDynamicsSettings({ gravity: [0, -1.62] }),
      setDynamicsSettings({ barDensity: 2, plateDensity: 3 }),
    );
    expect(doc.dynamics).toEqual({ gravity: [0, -1.62], barDensity: 2, plateDensity: 3 });
  });

  it("rejects non-finite gravity and non-positive densities", () => {
    for (const recipe of [
      setDynamicsSettings({ gravity: [NaN, 0] }),
      setDynamicsSettings({ barDensity: 0 }),
      setDynamicsSettings({ plateDensity: -1 }),
    ]) {
      expect(() => apply(base, recipe)).toThrow(CommandError);
    }
  });
});

describe("setMotorDynamics", () => {
  it("switches between motion and effort", () => {
    const effort = apply(base, setMotorDynamics("motor-1", { mode: "effort", expression: "2*t" }));
    expect(effort.motors[0].dynamics).toEqual({ mode: "effort", expression: "2*t" });
    const motion = apply(effort, setMotorDynamics("motor-1", { mode: "motion" }));
    expect(motion.motors[0].dynamics).toEqual({ mode: "motion" });
  });

  it("rejects an unknown motor and an empty expression", () => {
    expect(() => apply(base, setMotorDynamics("nope", { mode: "motion" }))).toThrow(CommandError);
    expect(() =>
      apply(base, setMotorDynamics("motor-1", { mode: "effort", expression: "  " })),
    ).toThrow(CommandError);
  });
});

describe("setLoad", () => {
  it("edits a load's site, force and torque", () => {
    const doc = apply(base, setLoad("load-1", { siteId: "site-5", force: [3, -0], torque: 1 }));
    expect(doc.loads[0]).toMatchObject({ siteId: "site-5", force: [3, 0], torque: 1 });
  });

  it("rejects unknown loads and sites, and non-finite values", () => {
    for (const recipe of [
      setLoad("nope", {}),
      setLoad("load-1", { siteId: "nope" }),
      setLoad("load-1", { force: [Infinity, 0] }),
      setLoad("load-1", { torque: NaN }),
    ]) {
      expect(() => apply(base, recipe)).toThrow(CommandError);
    }
  });
});

describe("deleteEntities with springs", () => {
  it("deletes a spring directly", () => {
    const doc = apply(base, linear, torsional, deleteEntities(new Set(["spring-1"])));
    expect(doc.springs.map((s) => s.id)).toEqual(["spring-2"]);
  });

  it("cascades from a deleted link or joint", () => {
    const withSprings = apply(base, linear, torsional);
    expect(apply(withSprings, deleteEntities(new Set(["link-3"]))).springs).toEqual([]);
    const jointGone = apply(withSprings, deleteEntities(new Set(["joint-3"])));
    expect(jointGone.springs.map((s) => s.id)).toEqual(["spring-1"]);
  });
});

describe("planDuplicate with dynamics", () => {
  function ids(): (kind: EntityKind) => string {
    const counters = new Map<EntityKind, number>();
    return (kind) => {
      counters.set(kind, (counters.get(kind) ?? 0) + 1);
      return `${kind}-dup-${counters.get(kind)}`;
    };
  }

  it("copies mass properties, motor dynamics, loads and internal springs", () => {
    const doc = apply(
      base,
      setLinkMassProperties("link-3", { mass: 1, com: [10, 0], inertia: 0.1 }),
      setMotorDynamics("motor-1", { mode: "effort", expression: "1" }),
      addSpring({
        id: "spring-internal",
        kind: "linear",
        siteA: "site-4",
        siteB: "site-6",
        stiffness: 3,
        freeLength: 5,
      }),
      addSpring({ id: "spring-t", kind: "torsional", jointId: "joint-2", stiffness: 1 }),
      linear,
    );
    const { recipe, idMap } = planDuplicate(
      doc,
      new Set(["link-2", "link-3"]),
      { x: 5, y: 5 },
      ids(),
    );
    const next = produce(doc, recipe);
    expect(MechanismDocumentSchema.safeParse(next).success).toBe(true);
    expect(next.links.find((l) => l.id === idMap.get("link-3"))?.massProperties?.mass).toBe(1);
    // The load sits on the coupler's site-6.
    expect(next.loads).toHaveLength(2);
    // Both ends of spring-internal and joint-2 are duplicated; spring-1 touches ground.
    expect(next.springs.map((s) => s.id)).toEqual([
      "spring-internal",
      "spring-t",
      "spring-1",
      "spring-dup-1",
      "spring-dup-2",
    ]);
    expect(next.springs[3]).toMatchObject({
      siteA: idMap.get("site-4"),
      siteB: idMap.get("site-6"),
    });
    expect(next.springs[4]).toMatchObject({ jointId: idMap.get("joint-2") });
  });
});
