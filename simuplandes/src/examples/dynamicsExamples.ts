/**
 * Examples made for Dynamics analysis, built in code (they have no GraphThe
 * fixture: GraphThe has no masses, springs or gravity). Every call returns
 * a fresh document with new ids.
 */

import { createId, MechanismDocumentSchema, type MechanismDocument } from "../model";

/** Two 150 mm rods hanging from a ground pivot, released from 30° above horizontal, with a trace on the tip. */
export function buildDoublePendulum(): MechanismDocument {
  const length = 150;
  const angle = Math.PI / 6;
  const elbow: [number, number] = [length * Math.cos(angle), length * Math.sin(angle)];
  const ids = {
    ground: createId("link"),
    upper: createId("link"),
    lower: createId("link"),
    g: createId("site"),
    u0: createId("site"),
    u1: createId("site"),
    l0: createId("site"),
    l1: createId("site"),
  };
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    name: "Double pendulum",
    links: [
      {
        id: ids.ground,
        name: "ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [{ id: ids.g, name: "O", local: [0, 0] }],
      },
      {
        id: ids.upper,
        name: "upper",
        isGround: false,
        pose: { position: [0, 0], angle },
        shape: { kind: "bar" },
        sites: [
          { id: ids.u0, name: "O", local: [0, 0] },
          { id: ids.u1, name: "A", local: [length, 0] },
        ],
      },
      {
        id: ids.lower,
        name: "lower",
        isGround: false,
        pose: { position: elbow, angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: ids.l0, name: "A", local: [0, 0] },
          { id: ids.l1, name: "B", local: [length, 0] },
        ],
      },
    ],
    joints: [
      { id: createId("joint"), name: "O", type: "R", siteA: ids.g, siteB: ids.u0 },
      { id: createId("joint"), name: "A", type: "R", siteA: ids.u1, siteB: ids.l0 },
    ],
    markers: [{ id: createId("marker"), name: "tip", linkId: ids.lower, local: [length, 0] }],
  });
}

/**
 * A 0.5 kg block on a vertical rail, hung from a ground anchor by a spring
 * and damper (50 N/m, 0.6 N·s/m) and released 60 mm above its rest point:
 * a damped oscillation under gravity.
 */
export function buildMassSpring(): MechanismDocument {
  const mass = 0.5;
  const stiffness = 50;
  const freeLength = 100;
  // At rest the spring stretches m g / k = 98.1 mm; start 60 mm above that.
  const restY = -(freeLength + (mass * 9.81 * 1000) / stiffness);
  const startY = restY + 60;
  const ids = {
    ground: createId("link"),
    block: createId("link"),
    anchor: createId("site"),
    rail: createId("site"),
    blockSite: createId("site"),
    joint: createId("joint"),
  };
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    name: "Mass-spring",
    links: [
      {
        id: ids.ground,
        name: "ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: ids.anchor, name: "anchor", local: [0, 0] },
          { id: ids.rail, name: "rail", local: [0, -100] },
        ],
      },
      {
        id: ids.block,
        name: "block",
        isGround: false,
        pose: { position: [0, startY], angle: 0 },
        shape: {
          kind: "plate",
          outline: [
            [-20, -12],
            [20, -12],
            [20, 12],
            [-20, 12],
          ],
        },
        sites: [{ id: ids.blockSite, name: "P", local: [0, 0] }],
        massProperties: { mass, com: [0, 0], inertia: 1e-4 },
      },
    ],
    joints: [
      {
        id: ids.joint,
        name: "rail",
        type: "P",
        siteA: ids.rail,
        siteB: ids.blockSite,
        axis: [0, 1],
      },
    ],
    springs: [
      {
        id: createId("spring"),
        name: "spring",
        kind: "linear",
        siteA: ids.anchor,
        siteB: ids.blockSite,
        stiffness,
        damping: 0.6,
        freeLength,
      },
    ],
    markers: [{ id: createId("marker"), name: "block", linkId: ids.block, local: [0, 0] }],
  });
}
