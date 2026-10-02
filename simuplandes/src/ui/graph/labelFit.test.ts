import { describe, expect, it } from "vitest";
import { fitLabel, LABEL_MAX_FONT, LABEL_MIN_FONT, GLYPH_WIDTH_EM } from "./labelFit";

describe("fitLabel", () => {
  it('short labels keep the max font size: fitLabel("L5", 22) (inner-circle-width scale)', () => {
    expect(fitLabel("L5", 22)).toEqual({ text: "L5", fontSize: LABEL_MAX_FONT, truncated: false });
  });

  it('fitLabel("coupler", 50) shrinks the font (still readable, >= LABEL_MIN_FONT) but keeps the full text', () => {
    const fitted = fitLabel("coupler", 50);
    expect(fitted.text).toBe("coupler");
    expect(fitted.truncated).toBe(false);
    expect(fitted.fontSize).toBeLessThan(LABEL_MAX_FONT);
    expect(fitted.fontSize).toBeGreaterThanOrEqual(LABEL_MIN_FONT);
    expect(7 * GLYPH_WIDTH_EM * fitted.fontSize).toBeLessThanOrEqual(50);
  });

  it('fitLabel("Tierra", 96) fits untruncated at the max font size within the maxOutsideLabelWidth scale', () => {
    const fitted = fitLabel("Tierra", 96);
    expect(fitted.text).toBe("Tierra");
    expect(fitted.truncated).toBe(false);
    expect(fitted.fontSize).toBe(LABEL_MAX_FONT);
    expect(6 * GLYPH_WIDTH_EM * fitted.fontSize).toBeLessThanOrEqual(96);
  });

  it("a very long label truncates at the minimum font size with a trailing ellipsis, within maxOutsideLabelWidth (96)", () => {
    const fitted = fitLabel("Eslabón de acoplamiento extremadamente largo", 96);
    expect(fitted.fontSize).toBe(LABEL_MIN_FONT);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.endsWith("…")).toBe(true);
    expect(fitted.text.length * GLYPH_WIDTH_EM * LABEL_MIN_FONT).toBeLessThanOrEqual(96);
  });

  it("empty label is deterministic at the max font size, untruncated", () => {
    expect(fitLabel("", 96)).toEqual({ text: "", fontSize: LABEL_MAX_FONT, truncated: false });
  });

  it("is pure and deterministic across repeated calls", () => {
    const a = fitLabel("rocker", 96);
    const b = fitLabel("rocker", 96);
    expect(a).toEqual(b);
  });

  it("LABEL_MIN_FONT is never below 11 (legibility floor, 06-09)", () => {
    expect(LABEL_MIN_FONT).toBeGreaterThanOrEqual(11);
    expect(LABEL_MAX_FONT).toBeGreaterThanOrEqual(LABEL_MIN_FONT);
  });
});
