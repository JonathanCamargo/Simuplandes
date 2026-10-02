import { describe, expect, it } from "vitest";
import { degToRad } from "../model/units";
import { applyDynamicKey, initialDynamicInput, resolveDynamicInput } from "./dynamicInput";

describe("initialDynamicInput", () => {
  it("starts empty, length field active", () => {
    expect(initialDynamicInput()).toEqual({ field: "length", length: "", angle: "" });
  });
});

describe("applyDynamicKey", () => {
  it("appends digits to the active (length) field", () => {
    let s = initialDynamicInput();
    for (const key of ["1", "2", "0"]) {
      const result = applyDynamicKey(s, key);
      expect(result.action).toBe("edit");
      s = result.state;
    }
    expect(s.length).toBe("120");
    expect(s.angle).toBe("");
  });

  it("Tab switches the active field, then digits append to angle", () => {
    let s = initialDynamicInput();
    s = applyDynamicKey(s, "1").state;
    const tabbed = applyDynamicKey(s, "Tab");
    expect(tabbed.action).toBe("edit");
    s = tabbed.state;
    expect(s.field).toBe("angle");
    s = applyDynamicKey(s, "3").state;
    s = applyDynamicKey(s, "0").state;
    expect(s.angle).toBe("30");
    expect(s.length).toBe("1");
  });

  it("Tab twice returns to the length field", () => {
    let s = initialDynamicInput();
    s = applyDynamicKey(s, "Tab").state;
    s = applyDynamicKey(s, "Tab").state;
    expect(s.field).toBe("length");
  });

  it("Backspace deletes one character of the active field", () => {
    let s = initialDynamicInput();
    s = applyDynamicKey(s, "1").state;
    s = applyDynamicKey(s, "2").state;
    const result = applyDynamicKey(s, "Backspace");
    expect(result.action).toBe("edit");
    expect(result.state.length).toBe("1");
  });

  it("Backspace on an empty field is a no-op edit", () => {
    const s = initialDynamicInput();
    const result = applyDynamicKey(s, "Backspace");
    expect(result.state.length).toBe("");
  });

  it("accepts ',' as the decimal separator", () => {
    let s = initialDynamicInput();
    s = applyDynamicKey(s, "1").state;
    s = applyDynamicKey(s, ",").state;
    s = applyDynamicKey(s, "5").state;
    expect(s.length).toBe("1,5");
  });

  it("accepts '.' as the decimal separator", () => {
    let s = initialDynamicInput();
    s = applyDynamicKey(s, "1").state;
    s = applyDynamicKey(s, ".").state;
    s = applyDynamicKey(s, "5").state;
    expect(s.length).toBe("1.5");
  });

  it("ignores a second decimal separator", () => {
    let s = initialDynamicInput();
    s = applyDynamicKey(s, "1").state;
    s = applyDynamicKey(s, ".").state;
    const result = applyDynamicKey(s, ".");
    expect(result.action).toBe("edit");
    expect(result.state.length).toBe("1.");
    const result2 = applyDynamicKey(result.state, ",");
    expect(result2.state.length).toBe("1.");
  });

  it("reports 'unhandled' for a non-numeric key", () => {
    const s = initialDynamicInput();
    const result = applyDynamicKey(s, "a");
    expect(result.action).toBe("unhandled");
    expect(result.state).toBe(s);
  });

  it("Enter reports 'commit' without mutating the buffer", () => {
    const s = initialDynamicInput();
    const result = applyDynamicKey(s, "Enter");
    expect(result.action).toBe("commit");
    expect(result.state).toBe(s);
  });

  it("Escape reports 'cancel' without mutating the buffer", () => {
    const s = initialDynamicInput();
    const result = applyDynamicKey(s, "Escape");
    expect(result.action).toBe("cancel");
    expect(result.state).toBe(s);
  });
});

describe("resolveDynamicInput", () => {
  const start = { x: 0, y: 0 };

  it("length only: angle comes from the cursor direction", () => {
    const s = { field: "length" as const, length: "120", angle: "" };
    const cursor = { x: 10, y: 10 };
    const result = resolveDynamicInput(s, start, cursor);
    expect(result).toEqual({ length: 120, angle: Math.atan2(10, 10) });
  });

  it("length only, cursor at start: angle is 0", () => {
    const s = { field: "length" as const, length: "120", angle: "" };
    const result = resolveDynamicInput(s, start, start);
    expect(result).toEqual({ length: 120, angle: 0 });
  });

  it("angle only: length comes from |cursor - start|", () => {
    const s = { field: "angle" as const, length: "", angle: "30" };
    const cursor = { x: 3, y: 4 };
    const result = resolveDynamicInput(s, start, cursor);
    expect(result).toEqual({ length: 5, angle: degToRad(30) });
  });

  it("both typed: both are exact, ignoring the cursor", () => {
    const s = { field: "angle" as const, length: "120", angle: "30" };
    const cursor = { x: 999, y: -999 };
    const result = resolveDynamicInput(s, start, cursor);
    expect(result).toEqual({ length: 120, angle: degToRad(30) });
  });

  it("neither typed: both come from the cursor", () => {
    const s = initialDynamicInput();
    const cursor = { x: 3, y: 4 };
    const result = resolveDynamicInput(s, start, cursor);
    expect(result).toEqual({ length: 5, angle: Math.atan2(4, 3) });
  });

  it("a typed length of 0 is an error", () => {
    const s = { field: "length" as const, length: "0", angle: "" };
    expect(resolveDynamicInput(s, start, { x: 1, y: 0 })).toEqual({ error: "invalid-length" });
  });

  it("a negative typed length is an error", () => {
    const s = { field: "length" as const, length: "-5", angle: "" };
    expect(resolveDynamicInput(s, start, { x: 1, y: 0 })).toEqual({ error: "invalid-length" });
  });

  it("an unparsable typed length is an error", () => {
    const s = { field: "length" as const, length: "1.2.3", angle: "" };
    expect(resolveDynamicInput(s, start, { x: 1, y: 0 })).toEqual({ error: "invalid-length" });
  });

  it("an unparsable typed angle is an error", () => {
    const s = { field: "angle" as const, length: "", angle: "1.2.3" };
    expect(resolveDynamicInput(s, start, { x: 1, y: 0 })).toEqual({ error: "invalid-length" });
  });

  it("a comma-decimal typed length parses exactly", () => {
    const s = { field: "length" as const, length: "12,5", angle: "" };
    const result = resolveDynamicInput(s, start, { x: 1, y: 0 });
    expect(result).toEqual({ length: 12.5, angle: 0 });
  });
});
