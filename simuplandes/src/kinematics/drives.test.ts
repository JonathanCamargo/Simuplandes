import { describe, it, expect } from "vitest";
import { compileDrive, evaluateDrivesAtTime } from "./drives";
import type { KinematicSystem, CompiledMotor } from "./system";

describe("compileDrive — constant", () => {
  it("speed 2: value(3)=6, rate=2, accel=0", () => {
    const drive = compileDrive({ mode: "constant", speed: 2 });
    expect(drive.value(3)).toBeCloseTo(6, 12);
    expect(drive.rate(3)).toBeCloseTo(2, 12);
    expect(drive.accel(3)).toBeCloseTo(0, 12);
  });
});

describe("compileDrive — expression", () => {
  it('"0.5*sin(t)": value(1), rate ~ 0.5*cos(1) (1e-7), accel ~ -0.5*sin(1) (1e-5)', () => {
    const drive = compileDrive({ mode: "expression", expression: "0.5*sin(t)" });
    expect(drive.value(1)).toBeCloseTo(0.5 * Math.sin(1), 12);
    expect(Math.abs(drive.rate(1) - 0.5 * Math.cos(1))).toBeLessThan(1e-7);
    expect(Math.abs(drive.accel(1) - -0.5 * Math.sin(1))).toBeLessThan(1e-5);
  });
});

function fakeSystem(motors: CompiledMotor[]): KinematicSystem {
  return { motors } as unknown as KinematicSystem;
}

describe("evaluateDrivesAtTime", () => {
  it("reports ok:false with the motor id when a drive is null", () => {
    const motors: CompiledMotor[] = [
      { id: "m1", label: "m1", jointId: "j1", kind: "rotary", row: 0, drive: null },
    ];
    const result = evaluateDrivesAtTime(fakeSystem(motors), 1);
    expect(result.ok).toBe(false);
    expect(result.invalidMotorIds).toEqual(["m1"]);
  });

  it("reports ok:false with the motor id when a drive returns a non-finite number", () => {
    const motors: CompiledMotor[] = [
      {
        id: "m2",
        label: "m2",
        jointId: "j2",
        kind: "linear",
        row: 0,
        drive: { value: () => Number.POSITIVE_INFINITY, rate: () => 0, accel: () => 0 },
      },
    ];
    const result = evaluateDrivesAtTime(fakeSystem(motors), 1);
    expect(result.ok).toBe(false);
    expect(result.invalidMotorIds).toEqual(["m2"]);
  });

  it("reports ok:true and fills values/rates/accels for a valid constant drive", () => {
    const motors: CompiledMotor[] = [
      {
        id: "m3",
        label: "m3",
        jointId: "j3",
        kind: "rotary",
        row: 0,
        drive: compileDrive({ mode: "constant", speed: 2 }),
      },
    ];
    const result = evaluateDrivesAtTime(fakeSystem(motors), 3);
    expect(result.ok).toBe(true);
    expect(result.invalidMotorIds).toEqual([]);
    expect(result.values[0]).toBeCloseTo(6, 12);
    expect(result.rates[0]).toBeCloseTo(2, 12);
    expect(result.accels[0]).toBeCloseTo(0, 12);
  });
});
