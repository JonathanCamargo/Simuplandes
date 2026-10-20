import { describe, it, expect } from "vitest";
import { buildSweepTable, inverseDynamicsFrame, listQuantities, measureAll } from "./plots";
import { computeSweep } from "./sweep";
import { createSimSession } from "./session";
import { createDynamicsSession } from "./dynamicsSession";
import { build as buildSliderCrank } from "../kinematics/__fixtures__/sliderCrank";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { solveVelocityAcceleration } from "../kinematics";
import { createId, MechanismDocumentSchema } from "../model";

/** The slider-crank with a linear spring, a torsional spring and an effort motor on the rail. */
function loadedSliderCrank() {
  const base = buildSliderCrank();
  const rail = base.joints.find((joint) => joint.type === "P")!;
  const pinA = base.joints.find((joint) => joint.name === "A")!;
  const ground = base.links[0];
  const coupler = base.links[2];
  return MechanismDocumentSchema.parse({
    ...base,
    motors: [
      ...base.motors,
      {
        id: "motor-rail",
        name: "push",
        jointId: rail.id,
        kind: "linear",
        drive: { mode: "constant", speed: 0 },
        dynamics: { mode: "effort", expression: "2" },
      },
    ],
    springs: [
      {
        id: createId("spring"),
        name: "s1",
        kind: "linear",
        siteA: ground.sites[0].id,
        siteB: coupler.sites[1].id,
        stiffness: 100,
        freeLength: 50,
      },
      { id: createId("spring"), name: "t1", kind: "torsional", jointId: pinA.id, stiffness: 1 },
    ],
  });
}

describe("listQuantities with dynamics", () => {
  it("adds reactions, motors, springs and energy after the kinematic quantities", () => {
    const session = createDynamicsSession(loadedSliderCrank());
    const quantities = listQuantities(session.system!, session.dynamics);
    const kinematic = listQuantities(session.system!);
    expect(quantities.slice(0, kinematic.length)).toEqual(kinematic);
    const extra = quantities.slice(kinematic.length);
    // 4 joints x 3 + couple for the rail; rotary motor 2; effort motor 2; springs 2 + 2; energy 3.
    expect(extra).toHaveLength(13 + 2 + 2 + 4 + 3);
    expect(extra.filter((q) => q.token === "couple")).toHaveLength(1);
    expect(extra.find((q) => q.id === "motor-rail:thrust")).toBeUndefined();
    expect(extra.find((q) => q.id === "motor:motor-rail:thrust")).toMatchObject({
      unit: "N",
      source: "actuator",
      entityLabel: "push",
    });
    expect(extra.filter((q) => q.token === "torque")[0]).toMatchObject({
      unit: "N·m",
      source: "driver",
    });
    expect(extra.filter((q) => q.entityKind === "spring").map((q) => q.token)).toEqual([
      "tension",
      "length",
      "springTorque",
      "twist",
    ]);
    expect(extra.slice(-3).map((q) => q.id)).toEqual([
      "system:energy:kinetic",
      "system:energy:potential",
      "system:energy:total",
    ]);
    expect(extra.every((q) => q.linkIndex === -1)).toBe(true);
  });
});

describe("measureAll with a dynamics frame", () => {
  it("reads every dynamics quantity, and NaN without a frame", () => {
    const doc = loadedSliderCrank();
    const session = createDynamicsSession(doc);
    const system = session.system!;
    const dynamics = session.dynamics!;
    const quantities = listQuantities(system, dynamics);
    const k = solveVelocityAcceleration(
      system,
      session.start!.q,
      Float64Array.from([1]),
      Float64Array.from([0]),
    );
    const frame = inverseDynamicsFrame(dynamics, 0, session.start!.q, k.qDot, k.qDDot)!;
    const out = new Float64Array(quantities.length);
    measureAll(system, session.start!.q, k.qDot, k.qDDot, quantities, out, frame);
    const value = (id: string) => out[quantities.findIndex((q) => q.id === id)];
    const joint = frame.reactions.joints[0];
    expect(value(`joint:${joint.jointId}:fx`)).toBe(joint.fx);
    expect(value(`joint:${joint.jointId}:fy`)).toBe(joint.fy);
    expect(value(`joint:${joint.jointId}:force`)).toBeCloseTo(Math.hypot(joint.fx, joint.fy), 12);
    const rail = frame.reactions.joints[3];
    expect(value(`joint:${rail.jointId}:couple`)).toBe(rail.torque);
    expect(value("motor:motor-rail:thrust")).toBe(2);
    expect(value(`motor:${system.motors[0].id}:power`)).toBe(frame.drivers[0].power);
    const springs = quantities.filter((q) => q.entityKind === "spring");
    expect(value(springs[0].id)).toBe(frame.linearSprings[0].force);
    expect(value(springs[1].id)).toBe(frame.linearSprings[0].length);
    expect(value(springs[2].id)).toBe(frame.torsionalSprings[0].torque);
    expect(value(springs[3].id)).toBeCloseTo((frame.torsionalSprings[0].twist * 180) / Math.PI, 12);
    expect(value("system:energy:total")).toBeCloseTo(
      frame.energy.kinetic + frame.energy.potential,
      12,
    );
    expect(value("system:energy:kinetic")).toBe(frame.energy.kinetic);
    expect(value("system:energy:potential")).toBe(frame.energy.potential);

    measureAll(system, session.start!.q, k.qDot, k.qDDot, quantities, out);
    expect(value("system:energy:total")).toBeNaN();
  });

  it("returns no frame when inverse dynamics fails", () => {
    const session = createDynamicsSession(loadedSliderCrank());
    const n = session.system!.n;
    expect(
      inverseDynamicsFrame(
        session.dynamics!,
        0,
        new Float64Array(n).fill(NaN),
        new Float64Array(n),
        new Float64Array(n),
      ),
    ).toBeNull();
  });
});

describe("buildSweepTable with dynamics", () => {
  it("fills the force columns along the sweep", () => {
    const session = createSimSession(buildFourBar());
    const sweep = computeSweep(session.system!, session.start!, 0, { inputRate: 1 });
    const quantities = listQuantities(session.system!, session.dynamics);
    const table = buildSweepTable(session.system!, quantities, sweep.samples, {
      inputKind: "rotary",
      inputDisplayOffset: 0,
      dynamics: session.dynamics,
    });
    const torque = table.quantities.findIndex((q) => q.token === "torque");
    expect(table.columns[torque].every((v) => Number.isFinite(v))).toBe(true);
    // Gravity on the crank, coupler and rocker needs a varying torque around the turn.
    const column = Array.from(table.columns[torque]);
    expect(Math.max(...column) - Math.min(...column)).toBeGreaterThan(0.01);
  });
});
