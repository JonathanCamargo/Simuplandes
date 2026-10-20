import { describe, it, expect } from "vitest";
import { summarizeMotion } from "./motionSummary";
import type { MeasurementTable, QuantityDef } from "./plots";

function quantity(
  entityKind: "link" | "marker",
  entityId: string,
  token: QuantityDef["token"],
): QuantityDef {
  return {
    id: `${entityKind}:${entityId}:${token}`,
    entityKind,
    entityId,
    entityLabel: entityId,
    token,
    unit: token === "angle" ? "deg" : "len",
    linkIndex: 0,
  };
}

function table(quantities: QuantityDef[], columns: number[][]): MeasurementTable {
  return {
    xKind: "input",
    xUnit: "deg",
    x: Float64Array.from(columns[0].map((_, i) => i)),
    quantities,
    columns: columns.map((c) => Float64Array.from(c)),
    length: columns[0].length,
  };
}

describe("summarizeMotion", () => {
  it("returns empty lists without a table", () => {
    expect(summarizeMotion(null)).toEqual({ links: [], markers: [] });
  });

  it("classifies a full turn, an oscillation and a pure translation", () => {
    const summary = summarizeMotion(
      table(
        [
          quantity("link", "crank", "angle"),
          quantity("link", "rocker", "angle"),
          quantity("link", "slider", "angle"),
        ],
        [
          [0, 90, 180, 270, 360],
          [40, 60, 80, 60, 40],
          [0, 0, 0, 0, 0],
        ],
      ),
    );
    expect(summary.links).toEqual([
      { linkId: "crank", label: "crank", motion: { kind: "rotates", turns: 1 } },
      { linkId: "rocker", label: "rocker", motion: { kind: "oscillates", minDeg: 40, maxDeg: 80 } },
      { linkId: "slider", label: "slider", motion: { kind: "translates" } },
    ]);
  });

  it("counts a backward turn as a turn", () => {
    const summary = summarizeMotion(table([quantity("link", "a", "angle")], [[10, -100, -350]]));
    expect(summary.links[0].motion).toEqual({ kind: "rotates", turns: 1 });
  });

  it("measures each marker's curve from its x and y columns, ignoring other link quantities", () => {
    const summary = summarizeMotion(
      table(
        [
          quantity("marker", "P", "x"),
          quantity("link", "a", "omega"),
          quantity("marker", "P", "y"),
        ],
        [
          [0, 10, 4],
          [1, 1, 1],
          [-2, 3, 8],
        ],
      ),
    );
    expect(summary.links).toEqual([]);
    expect(summary.markers).toEqual([{ markerId: "P", label: "P", width: 10, height: 10 }]);
  });
});
