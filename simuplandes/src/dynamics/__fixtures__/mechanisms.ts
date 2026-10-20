/**
 * Test mechanisms for dynamics, with closed-form answers where they exist.
 * Built through the kinematics fixture helpers so every document is
 * schema-valid.
 */

import { defineLink, makeDocument } from "../../kinematics/__fixtures__/build";
import { compileSystem, type KinematicSystem } from "../../kinematics";
import { compileDynamics, type DynamicSystem } from "../system";
import {
  createId,
  poseFromWorldPoints,
  type LengthUnit,
  type MassProperties,
  type MechanismDocument,
  type MechanismDocumentInput,
  type Motor,
} from "../../model";

export interface PendulumOptions {
  /** Pivot-to-tip length, model units. Default 1000 (mm). */
  readonly length?: number;
  readonly unit?: LengthUnit;
  /** Initial angle from +x, radians. Default 0 (horizontal). */
  readonly angle?: number;
  readonly massProperties?: MassProperties;
  /** Adds a motion motor at the pivot. */
  readonly motor?: Partial<Pick<Motor, "drive" | "dynamics">>;
  readonly gravity?: [number, number];
  /** Put the ground link on siteB of the pivot joint instead of siteA. */
  readonly groundOnB?: boolean;
}

/**
 * A single bar pendulum pivoted at the world origin. With the default auto
 * mass properties it is a uniform rod (0.5 kg/m).
 */
export function pendulum(options: PendulumOptions = {}): MechanismDocument {
  const length = options.length ?? 1000;
  const angle = options.angle ?? 0;
  const tip: [number, number] = [length * Math.cos(angle), length * Math.sin(angle)];
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { O: [0, 0] },
  });
  const pose = poseFromWorldPoints({ x: 0, y: 0 }, { x: tip[0], y: tip[1] });
  const bar = defineLink({
    name: "bar",
    origin: pose.position,
    angle: pose.angle,
    sites: { O: [0, 0], T: tip },
  });
  const link = options.massProperties
    ? { ...bar.link, massProperties: options.massProperties }
    : bar.link;
  const jointId = createId("joint");
  const joint = options.groundOnB
    ? { id: jointId, name: "O", type: "R" as const, siteA: bar.siteIds.O, siteB: ground.siteIds.O }
    : { id: jointId, name: "O", type: "R" as const, siteA: ground.siteIds.O, siteB: bar.siteIds.O };
  const motors: MechanismDocumentInput["motors"] = options.motor
    ? [
        {
          id: createId("motor"),
          name: "M",
          jointId,
          kind: "rotary",
          drive: options.motor.drive ?? { mode: "constant", speed: 0 },
          dynamics: options.motor.dynamics ?? { mode: "motion" },
        },
      ]
    : [];
  return makeDocument({
    schemaVersion: 2,
    name: "pendulum",
    units: { length: options.unit ?? "mm" },
    links: [ground.link, link],
    joints: [joint],
    motors,
    dynamics: { gravity: options.gravity ?? [0, -9.81] },
  });
}

/** Two uniform rods chained from the origin, both starting horizontal. */
export function doublePendulum(length = 500): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { O: [0, 0] },
  });
  const upper = defineLink({
    name: "upper",
    origin: [0, 0],
    sites: { O: [0, 0], A: [length, 0] },
  });
  const lower = defineLink({
    name: "lower",
    origin: [length, 0],
    sites: { A: [length, 0], B: [2 * length, 0] },
  });
  return makeDocument({
    schemaVersion: 2,
    name: "double pendulum",
    links: [ground.link, upper.link, lower.link],
    joints: [
      { id: createId("joint"), type: "R", siteA: ground.siteIds.O, siteB: upper.siteIds.O },
      { id: createId("joint"), type: "R", siteA: upper.siteIds.A, siteB: lower.siteIds.A },
    ],
  });
}

export interface OscillatorOptions {
  readonly mass?: number;
  readonly stiffness?: number;
  readonly damping?: number;
  /** Initial stretch beyond the free length, model units. */
  readonly stretch?: number;
  readonly unit?: LengthUnit;
  /** Drive the slide with a linear effort motor instead of a spring. */
  readonly effort?: string;
}

/**
 * A block on a horizontal rail, tied to ground by a linear spring along the
 * rail, with gravity off: `x(t) = stretch * cos(sqrt(k/m) t)` undamped.
 */
export function oscillator(options: OscillatorOptions = {}): MechanismDocument {
  const mass = options.mass ?? 2;
  const freeLength = 100;
  const x0 = freeLength + (options.stretch ?? 20);
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { O: [0, 0], R: [0, 0] },
  });
  const block = defineLink({
    name: "block",
    origin: [x0, 0],
    sites: { P: [x0, 0] },
  });
  const jointId = createId("joint");
  return makeDocument({
    schemaVersion: 2,
    name: "oscillator",
    units: { length: options.unit ?? "mm" },
    links: [ground.link, { ...block.link, massProperties: { mass, com: [0, 0], inertia: 0.01 } }],
    joints: [
      { id: jointId, type: "P", siteA: ground.siteIds.R, siteB: block.siteIds.P, axis: [1, 0] },
    ],
    motors: options.effort
      ? [
          {
            id: createId("motor"),
            jointId,
            kind: "linear",
            drive: { mode: "constant", speed: 0 },
            dynamics: { mode: "effort", expression: options.effort },
          },
        ]
      : [],
    springs: options.effort
      ? []
      : [
          {
            id: createId("spring"),
            kind: "linear",
            siteA: ground.siteIds.O,
            siteB: block.siteIds.P,
            stiffness: options.stiffness ?? 800,
            damping: options.damping ?? 0,
            freeLength,
          },
        ],
    dynamics: { gravity: [0, 0] },
  });
}

/** Compiles `doc` for dynamics: motion motors become kinematic drivers, effort motors actuators. */
export function compileForDynamics(
  doc: MechanismDocument,
  efforts = true,
): { kin: KinematicSystem; dyn: DynamicSystem } {
  const motionDoc = efforts
    ? { ...doc, motors: doc.motors.filter((motor) => motor.dynamics.mode === "motion") }
    : doc;
  const kin = compileSystem(motionDoc);
  const dyn = compileDynamics(doc, kin, { efforts });
  return { kin, dyn };
}
