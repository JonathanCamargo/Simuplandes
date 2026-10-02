import { describe, it, expect } from "vitest";
import {
  LENGTH_UNITS,
  DEFAULT_LENGTH_UNIT,
  radToDeg,
  degToRad,
  formatAngle,
  formatLength,
} from "./units";

describe("units", () => {
  it("exposes LENGTH_UNITS and DEFAULT_LENGTH_UNIT", () => {
    expect(LENGTH_UNITS).toEqual(["mm", "m"]);
    expect(DEFAULT_LENGTH_UNIT).toBe("mm");
  });

  it("radToDeg converts radians to degrees", () => {
    expect(radToDeg(Math.PI)).toBe(180);
  });

  it("degToRad converts degrees to radians", () => {
    expect(degToRad(90)).toBe(Math.PI / 2);
  });

  it("radToDeg(degToRad(x)) round-trips", () => {
    for (const x of [-720, -15, 0, 37.5, 360]) {
      expect(radToDeg(degToRad(x))).toBeCloseTo(x, 10);
    }
  });

  it("formatAngle formats with default 1 fraction digit and degree sign", () => {
    expect(formatAngle(Math.PI / 6)).toBe("30.0°");
  });

  it("formatAngle honors fractionDigits = 0 and avoids -0", () => {
    expect(formatAngle(-Math.PI / 2, 0)).toBe("-90°");
  });

  it("formatLength formats with default 2 fraction digits", () => {
    expect(formatLength(12.5, "mm")).toBe("12.50 mm");
  });

  it("formatLength honors custom fractionDigits", () => {
    expect(formatLength(0.125, "m", 3)).toBe("0.125 m");
  });
});
