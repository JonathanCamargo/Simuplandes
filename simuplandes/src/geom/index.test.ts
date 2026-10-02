import { describe, it, expect } from "vitest";
import * as geom from "./index";
import * as vec2Module from "./vec2";
import * as frameModule from "./frame";

describe("geom barrel", () => {
  it("re-exports every vec2 name as the same function/value object", () => {
    expect(geom.ZERO).toBe(vec2Module.ZERO);
    expect(geom.vec2).toBe(vec2Module.vec2);
    expect(geom.add).toBe(vec2Module.add);
    expect(geom.sub).toBe(vec2Module.sub);
    expect(geom.scale).toBe(vec2Module.scale);
    expect(geom.negate).toBe(vec2Module.negate);
    expect(geom.dot).toBe(vec2Module.dot);
    expect(geom.cross).toBe(vec2Module.cross);
    expect(geom.perp).toBe(vec2Module.perp);
    expect(geom.magnitude).toBe(vec2Module.magnitude);
    expect(geom.distance).toBe(vec2Module.distance);
    expect(geom.normalize).toBe(vec2Module.normalize);
    expect(geom.direction).toBe(vec2Module.direction);
    expect(geom.fromPolar).toBe(vec2Module.fromPolar);
    expect(geom.rotate).toBe(vec2Module.rotate);
  });

  it("re-exports every frame name as the same function object", () => {
    expect(geom.localToWorld).toBe(frameModule.localToWorld);
    expect(geom.worldToLocal).toBe(frameModule.worldToLocal);
  });
});
