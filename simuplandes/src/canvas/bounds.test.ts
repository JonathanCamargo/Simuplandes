import { describe, it, expect } from "vitest";
import { expandBounds, documentBounds, motionBounds, unionBounds } from "./bounds";
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
  it("includes annotations, padded by half their width", () => {
    const doc: MechanismDocument = {
      ...createEmptyDocument(),
      annotations: [
        {
          id: "n",
          kind: "stroke",
          points: [
            [10, 20],
            [30, -5],
          ],
          color: "ink",
          width: 4,
        },
      ],
    };
    expect(documentBounds(doc)).toEqual({ min: { x: 8, y: -7 }, max: { x: 32, y: 22 } });
  });

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

  it("uses posed geometry instead of the reference pose when poses are given", () => {
    const shifted = new Map(
      fourBarFixtureParsed.links.map((link) => [
        link.id,
        {
          position: [link.pose.position[0] + 1000, link.pose.position[1]] as [number, number],
          angle: link.pose.angle,
        },
      ]),
    );
    const bounds = documentBounds(fourBarFixtureParsed, { poses: shifted });
    expect(bounds?.min.x).toBeCloseTo(1000);
    expect(bounds?.min.y).toBeCloseTo(-10);
    expect(bounds?.max.x).toBeCloseTo(1140);
    expect(bounds?.max.y).toBeCloseTo(40);
  });

  it("falls back to the reference pose for links missing from the poses map", () => {
    expect(documentBounds(fourBarFixtureParsed, { poses: new Map() })).toEqual(
      documentBounds(fourBarFixtureParsed),
    );
  });

  it("includes every trace point", () => {
    const traces = [{ markerId: "m", points: [5, 6, -3, 20], closed: false }];
    expect(documentBounds(createEmptyDocument(), { traces })).toEqual({
      min: { x: -3, y: 6 },
      max: { x: 5, y: 20 },
    });
  });
});

describe("unionBounds", () => {
  const a = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
  const b = { min: { x: -5, y: 5 }, max: { x: 3, y: 20 } };

  it("covers both boxes", () => {
    expect(unionBounds(a, b)).toEqual({ min: { x: -5, y: 0 }, max: { x: 10, y: 20 } });
  });

  it("returns the other box when one is null", () => {
    expect(unionBounds(null, b)).toEqual(b);
    expect(unionBounds(a, null)).toEqual(a);
    expect(unionBounds(null, null)).toBeNull();
  });
});

describe("motionBounds", () => {
  it("with no sweep is the reference-pose bounds", () => {
    expect(motionBounds(fourBarFixtureParsed, [])).toEqual(documentBounds(fourBarFixtureParsed));
  });

  it("grows to every sampled pose of the sweep and every trace point", () => {
    const shifted = new Map(
      fourBarFixtureParsed.links.map((link) => [
        link.id,
        {
          position: [link.pose.position[0], link.pose.position[1] - 500] as [number, number],
          angle: link.pose.angle,
        },
      ]),
    );
    const traces = [{ markerId: "m", points: [900, 0], closed: false }];
    const bounds = motionBounds(fourBarFixtureParsed, [shifted], traces);
    expect(bounds?.min.y).toBeCloseTo(-510);
    expect(bounds?.max.y).toBeCloseTo(40);
    expect(bounds?.max.x).toBeCloseTo(900);
  });
});
