import { describe, it, expect } from "vitest";
import { EXAMPLES, loadExampleDocument } from "./registry";
import { verifyImportedDocument } from "../sim/importDeps";
import { createDynamicsSession } from "../sim/dynamicsSession";

const EXPECTED_LINKS: Record<string, number> = {
  "four-bar": 4,
  "slider-crank": 4,
  watt: 6,
  stephenson: 6,
  "eight-bar": 8,
};

describe("examples registry", () => {
  it("lists the seven examples in order with i18n keys", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      "four-bar",
      "slider-crank",
      "watt",
      "stephenson",
      "eight-bar",
      "double-pendulum",
      "mass-spring",
    ]);
    expect(EXAMPLES.map((e) => e.fixture)).toEqual([
      "fourbar-crank-rocker",
      "slider-crank",
      "watt-i",
      "stephenson-i",
      "eightbar-T15",
      null,
      null,
    ]);
    for (const e of EXAMPLES) {
      expect(e.titleKey).toBe(`gallery.examples.${e.id}.title`);
      expect(e.descriptionKey).toBe(`gallery.examples.${e.id}.description`);
    }
  });

  const KINEMATIC = EXAMPLES.filter((e) => e.analysis === "kinematics").map((e) => e.id);

  it.each(KINEMATIC)("%s loads a fresh document with one motor", (id) => {
    const a = loadExampleDocument(id);
    const b = loadExampleDocument(id);
    expect(a.links).toHaveLength(EXPECTED_LINKS[id]);
    expect(a.motors).toHaveLength(1);
    expect(a.links[0].id).not.toBe(b.links[0].id);
  });

  it("throws on an unknown id", () => {
    expect(() => loadExampleDocument("nope")).toThrow(/unknown example/);
  });

  // Real sim sweep (the eight-bar is the slowest): a generous budget so a
  // full-suite coverage run doesn't trip vitest's 5 s default.
  it.each(KINEMATIC)(
    "%s is drivable with >= 60 degrees of travel",
    (id) => {
      const verdict = verifyImportedDocument(loadExampleDocument(id));
      expect(verdict.status).toBe("ready");
      expect(verdict.rankDof).toBe(1);
      expect(verdict.rangeDeg).toBeGreaterThanOrEqual(60);
    },
    30_000,
  );
});

describe("dynamics examples", () => {
  it.each([
    ["double-pendulum", 2],
    ["mass-spring", 1],
  ] as const)("%s loads fresh and is ready for dynamics with %i free DOF", (id, dof) => {
    const a = loadExampleDocument(id);
    const b = loadExampleDocument(id);
    expect(a.links[0].id).not.toBe(b.links[0].id);
    expect(EXAMPLES.find((e) => e.id === id)?.analysis).toBe("dynamics");
    const session = createDynamicsSession(a);
    expect(session.summary.status).toBe("ready");
    expect(session.summary.dof).toBe(dof);
  });
});
