import { describe, expect, it } from "vitest";
import { PICK_RADIUS_PX, TOUCH_PICK_RADIUS_PX, pickRadiusPx } from "./pickRadius";

describe("pickRadiusPx", () => {
  it("widens the radius for touch only", () => {
    expect(pickRadiusPx("touch")).toBe(TOUCH_PICK_RADIUS_PX);
    expect(pickRadiusPx("mouse")).toBe(PICK_RADIUS_PX);
    expect(pickRadiusPx("pen")).toBe(PICK_RADIUS_PX);
    expect(pickRadiusPx(undefined)).toBe(PICK_RADIUS_PX);
    expect(TOUCH_PICK_RADIUS_PX).toBeGreaterThan(PICK_RADIUS_PX);
  });
});
