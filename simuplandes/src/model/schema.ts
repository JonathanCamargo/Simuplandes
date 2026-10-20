/**
 * The single source of truth for the shape of a mechanism document. Every
 * exported type is derived from `z.output`/`z.input` of the schemas below —
 * there are no hand-written duplicate interfaces (MDL-01).
 *
 * Conventions: the world is y-up; all positions are in model units
 * (`units.length` is a label only, "mm" default or "m", with no runtime
 * conversion, except that dynamics reads it to convert to SI); angles are
 * stored in radians. Dynamics quantities (mass, inertia, forces, stiffness)
 * are stored in SI units. Site/marker/outline/axis
 * coordinates are local to the owning link's `pose` (the reference/build
 * pose). The document never holds rendering or physics objects (MDL-01);
 * `shape` is purely a rendering concern, decoupled from the joint graph.
 */

import { z } from "zod";
import { LENGTH_UNITS, DEFAULT_LENGTH_UNIT } from "./units";

/** The largest |bulge| an arc edge may have (an included angle of about 304 degrees). */
export const MAX_BULGE = 4;

/** The current mechanism document schema version. Older versions are migrated (see `migrations/`). */
export const CURRENT_SCHEMA_VERSION = 2 as const;

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

/**
 * One edge of a link's shape: straight, a circular arc, or a cubic Bézier.
 * An arc's `bulge` is twice its sagitta over its chord, positive bowing to
 * the left of start -> end. A Bézier's `out`/`in` are its control points as
 * offsets from the start/end vertex. See `shapeGeometry.ts`.
 */
export const EdgeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line") }),
  z.object({ kind: z.literal("arc"), bulge: z.number() }),
  z.object({ kind: z.literal("bezier"), out: Vec2TupleSchema, in: Vec2TupleSchema }),
]);

/**
 * A link's rendered shape, decoupled from where its sites sit. A bar is the
 * polyline through the sites listed in `path`, in that order; sites left
 * off the path (spring attachments, extra ground pivots) are attachment
 * points only and do not change the bar's drawing or mass. A bar without a
 * `path` (documents saved before it existed) is given every site in order.
 * `edges` (optional; missing means all straight) curves the shape: a bar's
 * `edges[i]` joins `path[i]` to `path[i + 1]`, a plate's joins `outline[i]`
 * to the next vertex, wrapping around.
 */
export const LinkShapeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bar"),
    path: z.array(IdSchema).optional(),
    edges: z.array(EdgeSchema).optional(),
  }),
  z.object({
    kind: z.literal("plate"),
    outline: z.array(Vec2TupleSchema).min(3),
    edges: z.array(EdgeSchema).optional(),
  }),
]);

/**
 * A link's authored mass properties: `mass` in kg, `com` (center of mass)
 * in link-local model units, `inertia` in kg·m² about the center of mass.
 * A link without them gets mass properties computed from its shape and the
 * document's densities (`massProperties.ts`).
 */
export const MassPropertiesSchema = z.object({
  mass: z.number().nonnegative(),
  com: Vec2TupleSchema,
  inertia: z.number().nonnegative(),
});

/** A rigid body: ground or moving, with a reference pose, a shape, and sites. */
export const LinkSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    isGround: z.boolean(),
    color: z.string().optional(),
    pose: PoseSchema,
    shape: LinkShapeSchema,
    sites: z.array(SiteSchema),
    massProperties: MassPropertiesSchema.optional(),
  })
  .transform((link) => ({
    ...link,
    shape:
      link.shape.kind === "bar"
        ? {
            kind: "bar" as const,
            path: link.shape.path ?? link.sites.map((site) => site.id),
            ...(link.shape.edges ? { edges: link.shape.edges } : {}),
          }
        : link.shape,
  }));

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

/**
 * What a motor does in a dynamics simulation: follow its `drive` exactly
 * (`"motion"`), or apply an effort -- a torque in N·m (rotary) or a force
 * in N (linear) -- given by an expression in `t` (s), `q` (the joint's
 * input coordinate: rad, or model units) and `dq` (its rate). Kinematic
 * simulation always follows `drive`.
 */
export const MotorDynamicsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("motion") }),
  z.object({ mode: z.literal("effort"), expression: z.string().min(1) }),
]);

/** A motor driving a joint. `kind` must match the joint's type ("rotary" <-> R, "linear" <-> P). */
export const MotorSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  jointId: IdSchema,
  kind: z.enum(["rotary", "linear"]),
  drive: MotorDriveSchema,
  dynamics: MotorDynamicsSchema.default(() => ({ mode: "motion" as const })),
});

/** A named point tracked on a link, local to that link's pose. */
export const MarkerSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  linkId: IdSchema,
  local: Vec2TupleSchema,
});

/** A constant force (N, world frame) and torque (N·m, CCW positive) applied at a site. Read by dynamics only. */
export const LoadSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  siteId: IdSchema,
  force: Vec2TupleSchema.default(() => [0, 0] as [number, number]),
  torque: z.number().default(0),
});

/**
 * A spring-damper between two sites on different links: `stiffness` in N/m,
 * `damping` in N·s/m, `freeLength` in model units. The force acts along the
 * line between the two sites.
 */
export const LinearSpringSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  kind: z.literal("linear"),
  siteA: IdSchema,
  siteB: IdSchema,
  stiffness: z.number().nonnegative(),
  damping: z.number().nonnegative().default(0),
  freeLength: z.number().nonnegative(),
});

/**
 * A torsional spring-damper on a revolute joint: `stiffness` in N·m/rad,
 * `damping` in N·m·s/rad. `freeAngle` (rad) is the unstretched relative
 * rotation, measured from the reference pose.
 */
export const TorsionalSpringSchema = z.object({
  id: IdSchema,
  name: z.string().default(""),
  kind: z.literal("torsional"),
  jointId: IdSchema,
  stiffness: z.number().nonnegative(),
  damping: z.number().nonnegative().default(0),
  freeAngle: z.number().default(0),
});

/** A spring: linear (site to site) or torsional (on an R joint). */
export const SpringSchema = z.discriminatedUnion("kind", [
  LinearSpringSchema,
  TorsionalSpringSchema,
]);

/**
 * The colors an annotation stroke can take. They are names, not CSS
 * colors: each theme draws them in its own shade (see `CanvasTokens`), so
 * "ink" stays readable on both light and dark paper.
 */
export const ANNOTATION_COLORS = ["ink", "red", "blue", "green", "orange"] as const;

/**
 * A hand-drawn note on the drawing: a freehand stroke through `points`
 * (WORLD coordinates, model units), `width` model units wide. Annotations
 * are static -- they pan and zoom with the drawing but belong to no link,
 * never move in simulation and never affect the mechanism.
 */
export const AnnotationSchema = z.object({
  id: IdSchema,
  kind: z.literal("stroke"),
  points: z.array(Vec2TupleSchema).min(1),
  color: z.enum(ANNOTATION_COLORS),
  width: z.number().positive(),
});

/** The default gravity, m/s² (world y-up). */
export const DEFAULT_GRAVITY: readonly [number, number] = [0, -9.81];
/** The default linear density of a bar, kg/m. */
export const DEFAULT_BAR_DENSITY = 0.5;
/** The default areal density of a plate, kg/m². */
export const DEFAULT_PLATE_DENSITY = 10;

/** Document-level dynamics settings: gravity (m/s²) and the densities behind computed mass properties. */
export const DynamicsSettingsSchema = z.object({
  gravity: Vec2TupleSchema.default((): [number, number] => [
    DEFAULT_GRAVITY[0],
    DEFAULT_GRAVITY[1],
  ]),
  barDensity: z.number().positive().default(DEFAULT_BAR_DENSITY),
  plateDensity: z.number().positive().default(DEFAULT_PLATE_DENSITY),
});

/** Document-level unit settings. */
export const UnitsSchema = z.object({
  length: LengthUnitSchema.default(DEFAULT_LENGTH_UNIT),
});

/** The stored name of a document nobody has named yet; the UI shows it translated. */
export const DEFAULT_DOCUMENT_NAME = "Untitled mechanism";

const MechanismDocumentBaseSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  name: z.string().default(DEFAULT_DOCUMENT_NAME),
  units: UnitsSchema.default(() => ({ length: DEFAULT_LENGTH_UNIT })),
  links: z.array(LinkSchema).default(() => []),
  joints: z.array(JointSchema).default(() => []),
  motors: z.array(MotorSchema).default(() => []),
  markers: z.array(MarkerSchema).default(() => []),
  loads: z.array(LoadSchema).default(() => []),
  springs: z.array(SpringSchema).default(() => []),
  annotations: z.array(AnnotationSchema).default(() => []),
  dynamics: DynamicsSettingsSchema.default(() => ({
    gravity: [DEFAULT_GRAVITY[0], DEFAULT_GRAVITY[1]] as [number, number],
    barDensity: DEFAULT_BAR_DENSITY,
    plateDensity: DEFAULT_PLATE_DENSITY,
  })),
});

type MechanismDocumentBase = z.output<typeof MechanismDocumentBaseSchema>;
type Link = z.output<typeof LinkSchema>;
type Joint = z.output<typeof JointSchema>;
type Motor = z.output<typeof MotorSchema>;
type Marker = z.output<typeof MarkerSchema>;
type Load = z.output<typeof LoadSchema>;
type Spring = z.output<typeof SpringSchema>;
type Annotation = z.output<typeof AnnotationSchema>;

/**
 * Checks whole-document referential integrity in one pass: duplicate ids
 * across all entity kinds, dangling joint/motor/marker/load references, a
 * bar path naming a site not on its link (or twice), a joint whose two
 * sites sit on the same link, a zero prismatic axis, a
 * motor `kind` that does not match its joint's type, at most one motor
 * per joint, a linear spring joining two sites of one link, and a torsional
 * spring on a joint that is not revolute. Exported for direct unit testing.
 */
export function checkDocumentIntegrity(
  doc: Pick<
    MechanismDocumentBase,
    "links" | "joints" | "motors" | "markers" | "loads" | "springs"
  > & {
    annotations?: readonly Annotation[];
  },
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
    // Zod still runs this check when another field failed, in which case the
    // link transform never ran and `path` may be missing.
    if (link.shape.kind === "bar" && Array.isArray(link.shape.path)) {
      const own = new Set(link.sites.map((site) => site.id));
      const seen = new Set<string>();
      link.shape.path.forEach((siteId, pi) => {
        if (!own.has(siteId)) {
          ctx.addIssue({
            code: "custom",
            path: ["links", li, "shape", "path", pi],
            message: `bar path site "${siteId}" is not a site of this link`,
          });
        } else if (seen.has(siteId)) {
          ctx.addIssue({
            code: "custom",
            path: ["links", li, "shape", "path", pi],
            message: `bar path repeats site "${siteId}"`,
          });
        }
        seen.add(siteId);
      });
    }
    const edges = link.shape.edges;
    if (edges) {
      const expected =
        link.shape.kind === "plate"
          ? link.shape.outline.length
          : Math.max(0, (link.shape.path?.length ?? link.sites.length) - 1);
      if (edges.length !== expected) {
        ctx.addIssue({
          code: "custom",
          path: ["links", li, "shape", "edges"],
          message: `expected ${expected} edges, got ${edges.length}`,
        });
      }
      edges.forEach((edge, ei) => {
        if (edge.kind === "arc" && !(Math.abs(edge.bulge) <= MAX_BULGE)) {
          ctx.addIssue({
            code: "custom",
            path: ["links", li, "shape", "edges", ei, "bulge"],
            message: `arc bulge must be within +-${MAX_BULGE}`,
          });
        }
      });
    }
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

  doc.annotations?.forEach((annotation, i) => addId(annotation.id, ["annotations", i, "id"]));

  doc.springs.forEach((spring: Spring, i: number) => {
    addId(spring.id, ["springs", i, "id"]);
    if (spring.kind === "torsional") {
      const jointType = jointTypeById.get(spring.jointId);
      if (jointType === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["springs", i, "jointId"],
          message: `unknown joint id "${spring.jointId}"`,
        });
      } else if (jointType !== "R") {
        ctx.addIssue({
          code: "custom",
          path: ["springs", i, "jointId"],
          message: "torsional spring requires an R joint",
        });
      }
      return;
    }
    const aExists = siteIds.has(spring.siteA);
    const bExists = siteIds.has(spring.siteB);
    if (!aExists) {
      ctx.addIssue({
        code: "custom",
        path: ["springs", i, "siteA"],
        message: `unknown site id "${spring.siteA}"`,
      });
    }
    if (!bExists) {
      ctx.addIssue({
        code: "custom",
        path: ["springs", i, "siteB"],
        message: `unknown site id "${spring.siteB}"`,
      });
    }
    if (aExists && bExists && siteLinkId.get(spring.siteA) === siteLinkId.get(spring.siteB)) {
      ctx.addIssue({
        code: "custom",
        path: ["springs", i, "siteB"],
        message: "spring connects two sites of the same link",
      });
    }
  });
}

/** The mechanism document: the single serializable, plain-JSON model (MDL-01). */
export const MechanismDocumentSchema =
  MechanismDocumentBaseSchema.superRefine(checkDocumentIntegrity);

export type MechanismDocument = z.output<typeof MechanismDocumentSchema>;
export type MechanismDocumentInput = z.input<typeof MechanismDocumentSchema>;
export type { Link, Joint, Motor, Marker, Load, Spring, Annotation };
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export type LinkShape = Link["shape"];
export type LinkShapeInput = z.input<typeof LinkShapeSchema>;
export type Edge = z.output<typeof EdgeSchema>;
export type Site = z.output<typeof SiteSchema>;
export type Pose = z.output<typeof PoseSchema>;
export type RevoluteJoint = z.output<typeof RevoluteJointSchema>;
export type PrismaticJoint = z.output<typeof PrismaticJointSchema>;
export type MotorDrive = z.output<typeof MotorDriveSchema>;
export type MotorDynamics = z.output<typeof MotorDynamicsSchema>;
export type MassProperties = z.output<typeof MassPropertiesSchema>;
export type LinearSpring = z.output<typeof LinearSpringSchema>;
export type TorsionalSpring = z.output<typeof TorsionalSpringSchema>;
export type DynamicsSettings = z.output<typeof DynamicsSettingsSchema>;
export type Units = z.output<typeof UnitsSchema>;
