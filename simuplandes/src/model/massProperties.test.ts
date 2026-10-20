import { describe, it, expect } from "vitest";
import { computedMassProperties, resolveMassProperties } from "./massProperties";
import { MechanismDocumentSchema, type Link } from "./schema";
import { fourBarFixtureParsed } from "./__fixtures__/fourBar";

const mmDoc = fourBarFixtureParsed;
const mDoc = MechanismDocumentSchema.parse({ ...fourBarFixtureParsed, units: { length: "m" } });

function bar(sites: [number, number][]): Link {
  return {
    id: "l",
    name: "",
    isGround: false,
    pose: { position: [0, 0], angle: 0 },
    shape: { kind: "bar", path: sites.map((_, i) => `s${i}`) },
    sites: sites.map((local, i) => ({ id: `s${i}`, name: "", local })),
  };
}

function plate(outline: [number, number][]): Link {
  return { ...bar([[0, 0]]), shape: { kind: "plate", outline } };
}

describe("computedMassProperties", () => {
  it("treats a two-site bar as a slender rod", () => {
    // 2 m at 0.5 kg/m -> 1 kg, I = m L^2 / 12.
    const props = computedMassProperties(
      bar([
        [0, 0],
        [2, 0],
      ]),
      mDoc,
    );
    expect(props.mass).toBeCloseTo(1, 12);
    expect(props.com).toEqual([1, 0]);
    expect(props.inertia).toBeCloseTo(4 / 12, 12);
  });

  it("converts millimetres to SI", () => {
    const props = computedMassProperties(
      bar([
        [0, 0],
        [2000, 0],
      ]),
      mmDoc,
    );
    expect(props.mass).toBeCloseTo(1, 12);
    expect(props.com).toEqual([1000, 0]);
    expect(props.inertia).toBeCloseTo(4 / 12, 12);
  });

  it("sums the segments of a bent bar with parallel-axis terms", () => {
    const props = computedMassProperties(
      bar([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
      mDoc,
    );
    // Two 0.5 kg rods centred at (0.5, 0) and (1, 0.5).
    expect(props.mass).toBeCloseTo(1, 12);
    expect(props.com[0]).toBeCloseTo(0.75, 12);
    expect(props.com[1]).toBeCloseTo(0.25, 12);
    const rod = (0.5 * 1) / 12;
    const offset = 0.5 * (0.25 * 0.25 + 0.25 * 0.25);
    expect(props.inertia).toBeCloseTo(2 * (rod + offset), 12);
  });

  it("gives a zero-length bar no mass", () => {
    expect(computedMassProperties(bar([[3, 4]]), mDoc)).toEqual({
      mass: 0,
      com: [3, 4],
      inertia: 0,
    });
    expect(computedMassProperties(bar([]), mDoc)).toEqual({ mass: 0, com: [0, 0], inertia: 0 });
  });

  it("treats a plate as a uniform lamina for either winding", () => {
    // A 2 x 1 rectangle at 10 kg/m^2: 20 kg, I = m (a^2 + b^2) / 12.
    const ccw: [number, number][] = [
      [1, 1],
      [3, 1],
      [3, 2],
      [1, 2],
    ];
    for (const outline of [ccw, [...ccw].reverse()]) {
      const props = computedMassProperties(plate(outline), mDoc);
      expect(props.mass).toBeCloseTo(20, 12);
      expect(props.com[0]).toBeCloseTo(2, 12);
      expect(props.com[1]).toBeCloseTo(1.5, 12);
      expect(props.inertia).toBeCloseTo((20 * (4 + 1)) / 12, 10);
    }
  });

  it("gives a degenerate plate no mass", () => {
    const props = computedMassProperties(
      plate([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
      mDoc,
    );
    expect(props).toEqual({ mass: 0, com: [0, 0], inertia: 0 });
  });
});

describe("resolveMassProperties", () => {
  it("prefers authored values", () => {
    const link: Link = {
      ...bar([
        [0, 0],
        [1, 0],
      ]),
      massProperties: { mass: 3, com: [0.2, 0.1], inertia: 0.5 },
    };
    expect(resolveMassProperties(link, mDoc)).toEqual({
      mass: 3,
      com: [0.2, 0.1],
      inertia: 0.5,
      source: "authored",
    });
  });

  it("falls back to computed values", () => {
    const resolved = resolveMassProperties(
      bar([
        [0, 0],
        [1, 0],
      ]),
      mDoc,
    );
    expect(resolved.source).toBe("computed");
    expect(resolved.mass).toBeCloseTo(0.5, 12);
  });
});
