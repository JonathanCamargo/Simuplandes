import { describe, it, expect } from "vitest";
import { EXAMPLES, loadExampleDocument } from "./registry";
import { verifyImportedDocument } from "../sim/importDeps";

const EXPECTED_LINKS: Record<string, number> = {
  "four-bar": 4,
  "slider-crank": 4,
  watt: 6,
  stephenson: 6,
  "eight-bar": 8,
};

describe("examples registry", () => {
  it("lists the five examples in order with i18n keys", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      "four-bar",
      "slider-crank",
      "watt",
      "stephenson",
      "eight-bar",
    ]);
    expect(EXAMPLES.map((e) => e.fixture)).toEqual([
      "fourbar-crank-rocker",
      "slider-crank",
      "watt-i",
      "stephenson-i",
      "eightbar-T15",
    ]);
    for (const e of EXAMPLES) {
      expect(e.titleKey).toBe(`gallery.examples.${e.id}.title`);
      expect(e.descriptionKey).toBe(`gallery.examples.${e.id}.description`);
    }
  });

  it.each(EXAMPLES.map((e) => e.id))("%s loads a fresh document with one motor", (id) => {
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
  it.each(EXAMPLES.map((e) => e.id))(
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
