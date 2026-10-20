import { describe, it, expect } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import { build as buildSliderCrank } from "../kinematics/__fixtures__/sliderCrank";
import { forwardDynamics, inverseDynamics } from "./solve";
import { reactionsFromLambda } from "./reactions";
import { compileForDynamics, oscillator, pendulum } from "./__fixtures__/mechanisms";

const g = 9.81;

/** The oscillator's block resting on its rail under gravity, with its center of mass 10 mm along the rail. */
function blockOnRail(swapSides = false): MechanismDocument {
  const doc = oscillator({ mass: 2 });
  const [ground, block] = doc.links;
  const joint = doc.joints[0];
  return MechanismDocumentSchema.parse({
    ...doc,
    links: [ground, { ...block, massProperties: { mass: 2, com: [10, 0], inertia: 0.01 } }],
    joints: [
      swapSides ? { ...joint, siteA: joint.siteB, siteB: joint.siteA, axis: [1, 0] } : { ...joint },
    ],
    springs: [],
    dynamics: { gravity: [0, -g] },
  });
}

describe("reactionsFromLambda", () => {
  it("reports a pin reaction on the moving link whichever side ground is on", () => {
    for (const groundOnB of [false, true]) {
      const { dyn } = compileForDynamics(pendulum({ motor: {}, groundOnB }));
      const zero = new Float64Array(3);
      const solution = inverseDynamics(dyn, 0, dyn.kin.q0, zero, zero);
      const { joints } = reactionsFromLambda(dyn, dyn.kin.q0, solution.lambda);
      expect(joints[0].type).toBe("R");
      expect(dyn.kin.links[joints[0].onLinkIndex].isGround).toBe(false);
      expect(joints[0].fy).toBeCloseTo(0.5 * g, 9);
      expect(joints[0].torque).toBe(0);
    }
  });

  it("gives the pin force of a falling rod", () => {
    const { dyn } = compileForDynamics(pendulum());
    const solution = forwardDynamics(dyn, 0, dyn.kin.q0, new Float64Array(3), new Float64Array(0));
    const { joints } = reactionsFromLambda(dyn, dyn.kin.q0, solution.lambda);
    // m (a_c - g) with a_c = alpha * l/2 = -3g/4.
    expect(joints[0].fx).toBeCloseTo(0, 9);
    expect(joints[0].fy).toBeCloseTo(0.5 * (g - (3 * g) / 4), 9);
  });

  it("reports a slider's normal force and couple on the moving link", () => {
    for (const swap of [false, true]) {
      const { dyn } = compileForDynamics(blockOnRail(swap));
      const solution = forwardDynamics(
        dyn,
        0,
        dyn.kin.q0,
        new Float64Array(3),
        new Float64Array(0),
      );
      const { joints } = reactionsFromLambda(dyn, dyn.kin.q0, solution.lambda);
      expect(joints[0].type).toBe("P");
      expect(dyn.kin.links[joints[0].onLinkIndex].isGround).toBe(false);
      expect(joints[0].fx).toBeCloseTo(0, 9);
      expect(joints[0].fy).toBeCloseTo(2 * g, 9);
      // The weight acts 10 mm along the rail from the slider point.
      expect(joints[0].torque).toBeCloseTo(2 * g * 0.01, 9);
      expect(solution.qDDot[0]).toBeCloseTo(0, 9);
    }
  });

  it("reports a linear motor's force in newtons", () => {
    const base = buildSliderCrank();
    const rail = base.joints.find((joint) => joint.type === "P")!;
    const doc = MechanismDocumentSchema.parse({
      ...base,
      motors: [
        {
          id: "motor-slide",
          jointId: rail.id,
          kind: "linear",
          drive: { mode: "constant", speed: 0 },
        },
      ],
      loads: [{ id: "push", siteId: rail.siteB, force: [-3, 0], torque: 0 }],
      dynamics: { gravity: [0, 0] },
    });
    const { dyn } = compileForDynamics(doc);
    const zero = new Float64Array(dyn.kin.n);
    const solution = inverseDynamics(dyn, 0, dyn.kin.q0, zero, zero);
    const { motors } = reactionsFromLambda(dyn, dyn.kin.q0, solution.lambda);
    expect(motors[0]).toMatchObject({ motorId: "motor-slide", kind: "linear" });
    // Holding the slider still against a 3 N push along -x takes +3 N.
    expect(motors[0].effort).toBeCloseTo(3, 9);
  });
});
