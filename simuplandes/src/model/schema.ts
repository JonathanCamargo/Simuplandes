/**
 * The single source of truth for the shape of a mechanism document. Every
 * exported type is derived from `z.output`/`z.input` of the schemas below —
 * there are no hand-written duplicate interfaces (MDL-01).
 *
 * Conventions: the world is y-up; all positions are in model units
 * (`units.length` is a label only, "mm" default or "m", with no runtime
 * conversion); angles are stored in radians. Site/marker/outline/axis
 * coordinates are local to the owning link's `pose` (the reference/build
 * pose). The document never holds rendering or physics objects (MDL-01);
 * `shape` is purely a rendering concern, decoupled from the joint graph.
 */

import { z } from "zod";
import { LENGTH_UNITS, DEFAULT_LENGTH_UNIT } from "./units";

/** The current mechanism document schema version. Future versions are migrated (see 02-03). */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** An opaque entity id. Uniqueness/referential integrity are checked in `checkDocumentIntegrity`. */
export const IdSchema = z.string().min(1);

/** A JSON tuple point `[x, y]`, y-up, model units. */
export const Vec2TupleSchema = z.tuple([z.number(), z.number()]);

/** A length unit label; see the module TSDoc for the no-conversion convention. */
export const LengthUnitSchema = z.enum(LENGTH_UNITS);

/** A link's reference/build pose: world position and angle (radians, CCW). */
export const PoseSchema = z.object({
  position: Vec2TupleSchema,
  angle: z.number(),
});

/** A named attachment point, local to its owning link's pose. */
export const SiteSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  local: Vec2TupleSchema,
});

/** A link's rendered shape, decoupled from where its sites sit. */
export const LinkShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bar") }),
  z.object({ kind: z.literal("plate"), outline: z.array(Vec2TupleSchema).min(3) }),
]);

/** A rigid body: ground or moving, with a reference pose, a shape, and sites. */
export const LinkSchema = z.object({
  id: IdSchema,
  name: z.string(),
  isGround: z.boolean(),
  color: z.string().optional(),
  pose: PoseSchema,
  shape: LinkShapeSchema,
  sites: z.array(SiteSchema),
});

/** A revolute (pin) joint between two sites on different links. */
export const RevoluteJointSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  type: z.literal("R"),
  siteA: IdSchema,
  siteB: IdSchema,
});

/** A prismatic (sliding) joint between two sites, with a non-zero slide axis in siteA's link-local frame. */
export const PrismaticJointSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  type: z.literal("P"),
  siteA: IdSchema,
  siteB: IdSchema,
  axis: Vec2TupleSchema,
});

/** A joint: revolute (R) or prismatic (P). */
export const JointSchema = z.discriminatedUnion("type", [
  RevoluteJointSchema,
  PrismaticJointSchema,
]);

/** A motor's drive: constant speed, or a time/scrubber-evaluated expression. */
export const MotorDriveSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("constant"), speed: z.number() }),
  z.object({ mode: z.literal("expression"), expression: z.string().min(1) }),
]);

/** A motor driving a joint. `kind` must match the joint's type ("rotary" <-> R, "linear" <-> P). */
export const MotorSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  jointId: IdSchema,
  kind: z.enum(["rotary", "linear"]),
  drive: MotorDriveSchema,
});

/** A named point tracked on a link, local to that link's pose. */
export const MarkerSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  linkId: IdSchema,
  local: Vec2TupleSchema,
});

/** A force/torque applied at a site. Placeholder for v2 dynamics. */
export const LoadSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  siteId: IdSchema,
  force: Vec2TupleSchema.default(() => [0, 0] as [number, number]),
  torque: z.number().default(0),
});

/** Document-level unit settings. */
export const UnitsSchema = z.object({
  length: LengthUnitSchema.default(DEFAULT_LENGTH_UNIT),
});

const MechanismDocumentBaseSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  name: z.string().default("Untitled mechanism"),
  units: UnitsSchema.default(() => ({ length: DEFAULT_LENGTH_UNIT })),
  links: z.array(LinkSchema).default(() => []),
  joints: z.array(JointSchema).default(() => []),
  motors: z.array(MotorSchema).default(() => []),
  markers: z.array(MarkerSchema).default(() => []),
  loads: z.array(LoadSchema).default(() => []),
});

type MechanismDocumentBase = z.output<typeof MechanismDocumentBaseSchema>;
type Link = z.output<typeof LinkSchema>;
type Joint = z.output<typeof JointSchema>;
type Motor = z.output<typeof MotorSchema>;
type Marker = z.output<typeof MarkerSchema>;
type Load = z.output<typeof LoadSchema>;

/**
 * Checks whole-document referential integrity in one pass: duplicate ids
 * across all entity kinds, dangling joint/motor/marker/load references, a
 * joint whose two sites sit on the same link, a zero prismatic axis, a
 * motor `kind` that does not match its joint's type, and at most one motor
 * per joint. Exported for direct unit testing.
 */
export function checkDocumentIntegrity(
  doc: Pick<MechanismDocumentBase, "links" | "joints" | "motors" | "markers" | "loads">,
  ctx: z.RefinementCtx,
): void {
  const seenIds = new Set<string>();
  const addId = (id: string, path: (string | number)[]): void => {
    if (seenIds.has(id)) {
      ctx.addIssue({ code: "custom", path, message: `duplicate id "${id}"` });
    } else {
      seenIds.add(id);
    }
  };

  const siteLinkId = new Map<string, string>();
  doc.links.forEach((link: Link, li: number) => {
    addId(link.id, ["links", li, "id"]);
    link.sites.forEach((site, si) => {
      addId(site.id, ["links", li, "sites", si, "id"]);
      siteLinkId.set(site.id, link.id);
    });
  });
  const linkIds = new Set(doc.links.map((l: Link) => l.id));
  const siteIds = new Set(siteLinkId.keys());

  const jointTypeById = new Map<string, Joint["type"]>();
  doc.joints.forEach((joint: Joint, i: number) => {
    addId(joint.id, ["joints", i, "id"]);
    jointTypeById.set(joint.id, joint.type);

    const aExists = siteIds.has(joint.siteA);
    const bExists = siteIds.has(joint.siteB);
    if (!aExists) {
      ctx.addIssue({
        code: "custom",
        path: ["joints", i, "siteA"],
        message: `unknown site id "${joint.siteA}"`,
      });
    }
    if (!bExists) {
      ctx.addIssue({
        code: "custom",
        path: ["joints", i, "siteB"],
        message: `unknown site id "${joint.siteB}"`,
      });
    }
    if (aExists && bExists && siteLinkId.get(joint.siteA) === siteLinkId.get(joint.siteB)) {
      ctx.addIssue({
        code: "custom",
        path: ["joints", i, "siteB"],
        message: "joint connects two sites of the same link",
      });
    }
    if (joint.type === "P") {
      const [ax, ay] = joint.axis;
      if (Math.hypot(ax, ay) === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["joints", i, "axis"],
          message: "prismatic joint axis must be non-zero",
        });
      }
    }
  });
  const jointIds = new Set(jointTypeById.keys());

  const motorJointsSeen = new Set<string>();
  doc.motors.forEach((motor: Motor, i: number) => {
    addId(motor.id, ["motors", i, "id"]);
    if (!jointIds.has(motor.jointId)) {
      ctx.addIssue({
        code: "custom",
        path: ["motors", i, "jointId"],
        message: `unknown joint id "${motor.jointId}"`,
      });
      return;
    }
    const jointType = jointTypeById.get(motor.jointId);
    if (motor.kind === "rotary" && jointType !== "R") {
      ctx.addIssue({
        code: "custom",
        path: ["motors", i, "kind"],
        message: "rotary motor requires an R joint",
      });
    }
    if (motor.kind === "linear" && jointType !== "P") {
      ctx.addIssue({
        code: "custom",
        path: ["motors", i, "kind"],
        message: "linear motor requires a P joint",
      });
    }
    if (motorJointsSeen.has(motor.jointId)) {
      ctx.addIssue({
        code: "custom",
        path: ["motors", i, "jointId"],
        message: `joint "${motor.jointId}" already has a motor`,
      });
    } else {
      motorJointsSeen.add(motor.jointId);
    }
  });

  doc.markers.forEach((marker: Marker, i: number) => {
    addId(marker.id, ["markers", i, "id"]);
    if (!linkIds.has(marker.linkId)) {
      ctx.addIssue({
        code: "custom",
        path: ["markers", i, "linkId"],
        message: `unknown link id "${marker.linkId}"`,
      });
    }
  });

  doc.loads.forEach((load: Load, i: number) => {
    addId(load.id, ["loads", i, "id"]);
    if (!siteIds.has(load.siteId)) {
      ctx.addIssue({
        code: "custom",
        path: ["loads", i, "siteId"],
        message: `unknown site id "${load.siteId}"`,
      });
    }
  });
}

/** The mechanism document: the single serializable, plain-JSON model (MDL-01). */
export const MechanismDocumentSchema =
  MechanismDocumentBaseSchema.superRefine(checkDocumentIntegrity);

export type MechanismDocument = z.output<typeof MechanismDocumentSchema>;
export type MechanismDocumentInput = z.input<typeof MechanismDocumentSchema>;
export type { Link, Joint, Motor, Marker, Load };
export type LinkShape = z.output<typeof LinkShapeSchema>;
export type Site = z.output<typeof SiteSchema>;
export type Pose = z.output<typeof PoseSchema>;
export type RevoluteJoint = z.output<typeof RevoluteJointSchema>;
export type PrismaticJoint = z.output<typeof PrismaticJointSchema>;
export type MotorDrive = z.output<typeof MotorDriveSchema>;
export type Units = z.output<typeof UnitsSchema>;
