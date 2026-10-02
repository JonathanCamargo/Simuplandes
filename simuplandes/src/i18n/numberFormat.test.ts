import { describe, it, expect } from "vitest";
import { parseNumberInput, formatNumber } from "./numberFormat";

describe("parseNumberInput", () => {
  it("accepts a comma decimal separator", () => {
    expect(parseNumberInput("12,5")).toBe(12.5);
  });

  it("accepts a point decimal separator", () => {
    expect(parseNumberInput("12.5")).toBe(12.5);
  });

  it("accepts a leading minus with no decimal part", () => {
    expect(parseNumberInput("-3")).toBe(-3);
  });

  it("rejects an empty string", () => {
    expect(parseNumberInput("")).toBeNull();
  });

  it("rejects whitespace-only input", () => {
    expect(parseNumberInput("   ")).toBeNull();
  });

  it("rejects two decimal separators", () => {
    expect(parseNumberInput("1.2.3")).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseNumberInput("abc")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseNumberInput("  42  ")).toBe(42);
  });

  it("does not lenient-prefix-parse trailing garbage", () => {
    expect(parseNumberInput("12abc")).toBeNull();
  });

  it("rejects an overflowing digit string that would parse to Infinity", () => {
    expect(parseNumberInput("1".repeat(400))).toBeNull();
  });
});

describe("formatNumber", () => {
  it("uses a comma decimal separator for es", () => {
    expect(formatNumber(1234.5, "es", 1)).toBe("1234,5");
  });

  it("uses a point decimal separator for en", () => {
    expect(formatNumber(1234.5, "en", 1)).toBe("1234.5");
  });

  it("never renders -0 for a value rounding to zero (es)", () => {
    expect(formatNumber(-0.001, "es", 1)).toBe("0,0");
  });

  it("never renders -0 for a value rounding to zero (en)", () => {
    expect(formatNumber(-0.001, "en", 1)).toBe("0.0");
  });

  it("never renders -0 for exactly -0", () => {
    expect(formatNumber(-0, "en", 1)).toBe("0.0");
  });

  it("does not group thousands", () => {
    expect(formatNumber(12345.678, "en", 2)).toBe("12345.68");
  });
});
