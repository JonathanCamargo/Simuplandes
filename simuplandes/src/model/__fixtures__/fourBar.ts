import { MechanismDocumentSchema, type MechanismDocumentInput } from "../schema";

/**
 * A hand-written, internally-consistent four-bar fixture: ground + crank +
 * plate coupler + rocker, 4 R joints, 1 rotary motor, 1 marker, 1 load.
 * Shared by `schema.test.ts` and `document.test.ts`; reused by plans 02-02
 * and 02-03.
 */
export const fourBarFixture: MechanismDocumentInput = {
  schemaVersion: 1,
  name: "Four-bar",
  units: { length: "mm" },
  links: [
    {
      id: "link-1",
      name: "ground",
      isGround: true,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "site-1", local: [0, 0] },
        { id: "site-2", local: [140, 0] },
      ],
    },
    {
      id: "link-2",
      name: "crank",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "site-3", local: [0, 0] },
        { id: "site-4", local: [40, 0] },
      ],
    },
    {
      id: "link-3",
      name: "coupler",
      isGround: false,
      pose: { position: [40, 0], angle: 0 },
      shape: {
        kind: "plate",
        outline: [
          [-5, -10],
          [55, -10],
          [55, 10],
          [-5, 10],
        ],
      },
      sites: [
        { id: "site-5", local: [0, 0] },
        { id: "site-6", local: [50, 0] },
      ],
    },
    {
      id: "link-4",
      name: "rocker",
      isGround: false,
      pose: { position: [140, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "site-7", local: [0, 0] },
        { id: "site-8", local: [-30, 40] },
      ],
    },
  ],
  joints: [
    { id: "joint-1", type: "R", siteA: "site-1", siteB: "site-3" },
    { id: "joint-2", type: "R", siteA: "site-4", siteB: "site-5" },
    { id: "joint-3", type: "R", siteA: "site-6", siteB: "site-8" },
    { id: "joint-4", type: "R", siteA: "site-7", siteB: "site-2" },
  ],
  motors: [
    {
      id: "motor-1",
      jointId: "joint-1",
      kind: "rotary",
      drive: { mode: "constant", speed: 1 },
    },
  ],
  markers: [{ id: "marker-1", linkId: "link-3", local: [25, 0] }],
  loads: [{ id: "load-1", siteId: "site-6", force: [0, -1], torque: 0 }],
};

/** The four-bar fixture, already parsed (defaults filled in) for direct use in tests. */
export const fourBarFixtureParsed = MechanismDocumentSchema.parse(fourBarFixture);
