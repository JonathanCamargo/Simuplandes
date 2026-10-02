import { describe, it, expect } from "vitest";
import { expandBounds, documentBounds } from "./bounds";
import { createEmptyDocument, type MechanismDocument } from "../model";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";

describe("expandBounds", () => {
  it("starts a new 1-point bounds from null", () => {
    expect(expandBounds(null, { x: 3, y: -4 })).toEqual({
      min: { x: 3, y: -4 },
      max: { x: 3, y: -4 },
    });
  });

  it("grows an existing bounds to include a new point", () => {
    const b = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
    expect(expandBounds(b, { x: -5, y: 20 })).toEqual({
      min: { x: -5, y: 0 },
      max: { x: 10, y: 20 },
    });
  });

  it("leaves the bounds unchanged for an interior point", () => {
    const b = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
    expect(expandBounds(b, { x: 5, y: 5 })).toEqual(b);
  });
});

describe("documentBounds", () => {
  it("returns null for an empty document", () => {
    expect(documentBounds(createEmptyDocument())).toBeNull();
  });

  it("covers every site world position, plate outline vertex and marker for the four-bar fixture", () => {
    const bounds = documentBounds(fourBarFixtureParsed);
    expect(bounds).toEqual({ min: { x: 0, y: -10 }, max: { x: 140, y: 40 } });
  });

  it("skips a marker whose linkId does not resolve (defensive; the schema normally forbids this)", () => {
    const doc: MechanismDocument = {
      ...createEmptyDocument(),
      markers: [{ id: "marker-dangling", name: "", linkId: "no-such-link", local: [0, 0] }],
    };
    expect(documentBounds(doc)).toBeNull();
  });
});
