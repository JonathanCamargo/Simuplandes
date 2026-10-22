/**
 * Pure Immer recipe factories over `MechanismDocument`: no store, no id
 * minting. Each factory returns a `Recipe`, a function that mutates a draft
 * document (throwing `CommandError` before any mutation if a reference is
 * invalid). Recipes are meant to be run inside `produce`/`produceWithPatches`
 * by callers (the store's `execute()`, or `produce` directly in tests).
 */

import type { Draft } from "immer";
import { rotate, type Vec2 } from "../geom";
import {
  cleanNumber,
  degToRad,
  indexDocument,
  type Vec2Tuple,
  type EntityKind,
  type Id,
  type MechanismDocument,
  type Link,
  type Site,
  type LinkShapeInput,
  type LinkShape,
  type Edge,
  type AnnotationColor,
  MAX_BULGE,
  remapEdges,
  type Pose,
  type MotorDrive,
  type MotorDynamics,
  type LengthUnit,
  type MassProperties,
  type DynamicsSettings,
} from "../model";

export type Recipe = (draft: Draft<MechanismDocument>) => void;

/** Thrown by a recipe when a reference is invalid or a duplicate id is used. Never leaves the draft mutated. */
export class CommandError extends Error {
  override name = "CommandError";
}

export interface SiteInput {
  id: Id;
  name?: string;
  local: Vec2Tuple;
}

export interface LinkInput {
  id: Id;
  name: string;
  isGround?: boolean;
  color?: string;
  pose?: Pose;
  /** A bar without a `path` runs through every site in `sites`, in order. */
  shape?: LinkShapeInput;
  sites: SiteInput[];
  massProperties?: MassProperties;
}

export type JointInput =
  | { id: Id; type: "R"; siteA: Id; siteB: Id; name?: string }
  | { id: Id; type: "P"; siteA: Id; siteB: Id; axis: Vec2Tuple; name?: string };

export interface MotorInput {
  id: Id;
  jointId: Id;
  name?: string;
  kind?: "rotary" | "linear";
  drive?: MotorDrive;
  dynamics?: MotorDynamics;
}

export interface MarkerInput {
  id: Id;
  linkId: Id;
  local: Vec2Tuple;
  name?: string;
}

export interface LoadInput {
  id: Id;
  siteId: Id;
  name?: string;
  force?: Vec2Tuple;
  torque?: number;
}

export type SpringInput =
  | {
      id: Id;
      kind: "linear";
      siteA: Id;
      siteB: Id;
      stiffness: number;
      freeLength: number;
      damping?: number;
      name?: string;
    }
  | {
      id: Id;
      kind: "torsional";
      jointId: Id;
      stiffness: number;
      freeAngle?: number;
      damping?: number;
      name?: string;
    };

/** The editable numbers of a spring. `freeLength` applies to linear springs, `freeAngle` to torsional ones. */
export interface SpringParameters {
  stiffness?: number;
  damping?: number;
  freeLength?: number;
  freeAngle?: number;
}

type DraftDoc = Draft<MechanismDocument>;
type DraftLink = DraftDoc["links"][number];
type DraftSite = DraftLink["sites"][number];

/** Normalizes a tuple's components, so `-0` never enters the document (see `cleanNumber`). */
function cleanTuple(t: readonly [number, number]): Vec2Tuple {
  return [cleanNumber(t[0]), cleanNumber(t[1])];
}

/** Walks every entity array in the draft, collecting all ids currently in use. */
function collectDraftIds(doc: DraftDoc): Set<Id> {
  const ids = new Set<Id>();
  for (const link of doc.links) {
    ids.add(link.id);
    for (const site of link.sites) ids.add(site.id);
  }
  for (const joint of doc.joints) ids.add(joint.id);
  for (const motor of doc.motors) ids.add(motor.id);
  for (const marker of doc.markers) ids.add(marker.id);
  for (const load of doc.loads) ids.add(load.id);
  for (const spring of doc.springs) ids.add(spring.id);
  for (const annotation of doc.annotations) ids.add(annotation.id);
  return ids;
}

function assertNonNegative(value: number, what: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new CommandError(`${what} must be a non-negative number`);
  }
}

/** Finds a site and its owning link by site id, or undefined if not found. */
function findSite(doc: DraftDoc, id: Id): { site: DraftSite; link: DraftLink } | undefined {
  for (const link of doc.links) {
    const site = link.sites.find((s) => s.id === id);
    if (site) return { site, link };
  }
  return undefined;
}

/**
 * Validated, cleaned edges for a shape with `count` edges: finite numbers,
 * |bulge| within `MAX_BULGE`, and exactly `count` of them.
 */
function cleanEdges(edges: readonly Edge[], count: number): Edge[] {
  if (edges.length !== count) {
    throw new CommandError(`expected ${count} edges, got ${edges.length}`);
  }
  return edges.map((edge) => {
    if (edge.kind === "line") return { kind: "line" };
    if (edge.kind === "arc") {
      if (!(Math.abs(edge.bulge) <= MAX_BULGE)) {
        throw new CommandError(`arc bulge must be within +-${MAX_BULGE}`);
      }
      return { kind: "arc", bulge: cleanNumber(edge.bulge) };
    }
    const all = [...edge.out, ...edge.in];
    if (!all.every(Number.isFinite)) throw new CommandError("curve controls must be finite");
    return { kind: "bezier", out: cleanTuple(edge.out), in: cleanTuple(edge.in) };
  });
}

/** A new bar's shape: its path (see `barPath`) and, if given, its edges. */
function barShape(
  shape: Extract<LinkShapeInput, { kind: "bar" }> | undefined,
  sites: readonly SiteInput[],
): Extract<LinkShape, { kind: "bar" }> {
  const path = barPath(shape?.path, sites);
  return shape?.edges
    ? { kind: "bar", path, edges: cleanEdges(shape.edges, Math.max(0, path.length - 1)) }
    : { kind: "bar", path };
}

/** A bar's path: `path` checked against `sites`, or every site in order. */
function barPath(path: readonly Id[] | undefined, sites: readonly SiteInput[]): Id[] {
  if (path === undefined) return sites.map((s) => s.id);
  const own = new Set(sites.map((s) => s.id));
  if (path.some((id) => !own.has(id)) || new Set(path).size !== path.length) {
    throw new CommandError("bar path must list distinct sites of the link");
  }
  return [...path];
}

export function addLink(input: LinkInput): Recipe {
  return (draft) => {
    const ids = collectDraftIds(draft);
    if (ids.has(input.id)) {
      throw new CommandError(`duplicate id "${input.id}"`);
    }
    for (const site of input.sites) {
      if (ids.has(site.id)) {
        throw new CommandError(`duplicate id "${site.id}"`);
      }
      ids.add(site.id);
    }
    draft.links.push({
      id: input.id,
      name: input.name,
      isGround: input.isGround ?? false,
      ...(input.color !== undefined ? { color: input.color } : {}),
      pose: input.pose
        ? { position: cleanTuple(input.pose.position), angle: cleanNumber(input.pose.angle) }
        : { position: [0, 0], angle: 0 },
      shape:
        input.shape?.kind === "plate"
          ? {
              kind: "plate",
              outline: input.shape.outline.map((v) => cleanTuple(v)),
              ...(input.shape.edges
                ? { edges: cleanEdges(input.shape.edges, input.shape.outline.length) }
                : {}),
            }
          : barShape(input.shape, input.sites),
      sites: input.sites.map((s) => ({
        id: s.id,
        name: s.name ?? "",
        local: cleanTuple(s.local),
      })),
      ...(input.massProperties
        ? {
            massProperties: {
              mass: input.massProperties.mass,
              com: cleanTuple(input.massProperties.com),
              inertia: input.massProperties.inertia,
            },
          }
        : {}),
    });
  };
}

/**
 * Adds a site to a link. On a bar the site is an attachment point off the
 * bar's path unless `onPath` is set, which appends it to the path.
 */
export function addSite(linkId: Id, site: SiteInput, options?: { onPath?: boolean }): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    const ids = collectDraftIds(draft);
    if (ids.has(site.id)) throw new CommandError(`duplicate id "${site.id}"`);
    link.sites.push({ id: site.id, name: site.name ?? "", local: cleanTuple(site.local) });
    if (options?.onPath && link.shape.kind === "bar") {
      if (link.shape.edges && link.shape.path.length > 0) link.shape.edges.push({ kind: "line" });
      link.shape.path.push(site.id);
    }
  };
}

export function addJoint(input: JointInput): Recipe {
  return (draft) => {
    const ids = collectDraftIds(draft);
    if (ids.has(input.id)) throw new CommandError(`duplicate id "${input.id}"`);
    const siteA = findSite(draft, input.siteA);
    if (!siteA) throw new CommandError(`unknown site "${input.siteA}"`);
    const siteB = findSite(draft, input.siteB);
    if (!siteB) throw new CommandError(`unknown site "${input.siteB}"`);
    if (siteA.link.id === siteB.link.id) {
      throw new CommandError(`joint connects two sites of the same link "${siteA.link.id}"`);
    }
    if (input.type === "P") {
      const [ax, ay] = input.axis;
      if (Math.hypot(ax, ay) === 0) {
        throw new CommandError("prismatic joint axis must be non-zero");
      }
      draft.joints.push({
        id: input.id,
        name: input.name ?? "",
        type: "P",
        siteA: input.siteA,
        siteB: input.siteB,
        axis: cleanTuple(input.axis),
      });
    } else {
      draft.joints.push({
        id: input.id,
        name: input.name ?? "",
        type: "R",
        siteA: input.siteA,
        siteB: input.siteB,
      });
    }
  };
}

export function addMotor(input: MotorInput): Recipe {
  return (draft) => {
    const ids = collectDraftIds(draft);
    if (ids.has(input.id)) throw new CommandError(`duplicate id "${input.id}"`);
    const joint = draft.joints.find((j) => j.id === input.jointId);
    if (!joint) throw new CommandError(`unknown joint "${input.jointId}"`);
    if (draft.motors.some((m) => m.jointId === input.jointId)) {
      throw new CommandError(`joint "${input.jointId}" already has a motor`);
    }
    const kind = input.kind ?? (joint.type === "R" ? "rotary" : "linear");
    draft.motors.push({
      id: input.id,
      name: input.name ?? "",
      jointId: input.jointId,
      kind,
      drive: input.drive ?? { mode: "constant", speed: 1 },
      dynamics: input.dynamics ?? { mode: "motion" },
    });
  };
}

export function addMarker(input: MarkerInput): Recipe {
  return (draft) => {
    const ids = collectDraftIds(draft);
    if (ids.has(input.id)) throw new CommandError(`duplicate id "${input.id}"`);
    const link = draft.links.find((l) => l.id === input.linkId);
    if (!link) throw new CommandError(`unknown link "${input.linkId}"`);
    draft.markers.push({
      id: input.id,
      name: input.name ?? "",
      linkId: input.linkId,
      local: cleanTuple(input.local),
    });
  };
}

export function addLoad(input: LoadInput): Recipe {
  return (draft) => {
    const ids = collectDraftIds(draft);
    if (ids.has(input.id)) throw new CommandError(`duplicate id "${input.id}"`);
    const site = findSite(draft, input.siteId);
    if (!site) throw new CommandError(`unknown site "${input.siteId}"`);
    draft.loads.push({
      id: input.id,
      name: input.name ?? "",
      siteId: input.siteId,
      force: cleanTuple(input.force ?? [0, 0]),
      torque: cleanNumber(input.torque ?? 0),
    });
  };
}

/**
 * Changes a load's site, force (N, world) and/or torque (N·m). Unknown load
 * or site ids, and non-finite numbers, throw before mutating.
 */
export function setLoad(
  loadId: Id,
  edit: { siteId?: Id; force?: Vec2Tuple; torque?: number },
): Recipe {
  return (draft) => {
    const load = draft.loads.find((l) => l.id === loadId);
    if (!load) throw new CommandError(`unknown load "${loadId}"`);
    if (edit.siteId !== undefined && !findSite(draft, edit.siteId)) {
      throw new CommandError(`unknown site "${edit.siteId}"`);
    }
    const numbers = [...(edit.force ?? []), ...(edit.torque !== undefined ? [edit.torque] : [])];
    if (!numbers.every(Number.isFinite)) throw new CommandError("load values must be finite");
    if (edit.siteId !== undefined) load.siteId = edit.siteId;
    if (edit.force) load.force = cleanTuple(edit.force);
    if (edit.torque !== undefined) load.torque = cleanNumber(edit.torque);
  };
}

/**
 * Adds a linear spring (between two sites on different links) or a
 * torsional spring (on an R joint). Throws before mutating on a duplicate
 * id, a bad reference, or a negative stiffness, damping or free length.
 */
export function addSpring(input: SpringInput): Recipe {
  return (draft) => {
    const ids = collectDraftIds(draft);
    if (ids.has(input.id)) throw new CommandError(`duplicate id "${input.id}"`);
    assertNonNegative(input.stiffness, "stiffness");
    assertNonNegative(input.damping ?? 0, "damping");
    if (input.kind === "linear") {
      const a = findSite(draft, input.siteA);
      const b = findSite(draft, input.siteB);
      if (!a) throw new CommandError(`unknown site "${input.siteA}"`);
      if (!b) throw new CommandError(`unknown site "${input.siteB}"`);
      if (a.link.id === b.link.id) {
        throw new CommandError("a spring must connect two different links");
      }
      assertNonNegative(input.freeLength, "free length");
      draft.springs.push({
        id: input.id,
        name: input.name ?? "",
        kind: "linear",
        siteA: input.siteA,
        siteB: input.siteB,
        stiffness: cleanNumber(input.stiffness),
        damping: cleanNumber(input.damping ?? 0),
        freeLength: cleanNumber(input.freeLength),
      });
      return;
    }
    const joint = draft.joints.find((j) => j.id === input.jointId);
    if (!joint) throw new CommandError(`unknown joint "${input.jointId}"`);
    if (joint.type !== "R") throw new CommandError("a torsional spring needs an R joint");
    const freeAngle = input.freeAngle ?? 0;
    if (!Number.isFinite(freeAngle)) throw new CommandError("free angle must be finite");
    draft.springs.push({
      id: input.id,
      name: input.name ?? "",
      kind: "torsional",
      jointId: input.jointId,
      stiffness: cleanNumber(input.stiffness),
      damping: cleanNumber(input.damping ?? 0),
      freeAngle: cleanNumber(freeAngle),
    });
  };
}

/** Edits a spring's numbers. Throws before mutating on an unknown id, a negative value, or a parameter the spring kind lacks. */
export function setSpringParameters(springId: Id, params: SpringParameters): Recipe {
  return (draft) => {
    const spring = draft.springs.find((s) => s.id === springId);
    if (!spring) throw new CommandError(`unknown spring "${springId}"`);
    if (params.stiffness !== undefined) assertNonNegative(params.stiffness, "stiffness");
    if (params.damping !== undefined) assertNonNegative(params.damping, "damping");
    if (params.freeLength !== undefined) {
      if (spring.kind !== "linear")
        throw new CommandError("only a linear spring has a free length");
      assertNonNegative(params.freeLength, "free length");
    }
    if (params.freeAngle !== undefined) {
      if (spring.kind !== "torsional") {
        throw new CommandError("only a torsional spring has a free angle");
      }
      if (!Number.isFinite(params.freeAngle)) throw new CommandError("free angle must be finite");
    }
    if (params.stiffness !== undefined) spring.stiffness = cleanNumber(params.stiffness);
    if (params.damping !== undefined) spring.damping = cleanNumber(params.damping);
    if (params.freeLength !== undefined && spring.kind === "linear") {
      spring.freeLength = cleanNumber(params.freeLength);
    }
    if (params.freeAngle !== undefined && spring.kind === "torsional") {
      spring.freeAngle = cleanNumber(params.freeAngle);
    }
  };
}

/**
 * Sets (or, with `undefined`, clears) a link's authored mass properties.
 * Cleared, the link's mass properties are computed from its shape. Throws
 * before mutating on an unknown link or a negative mass or inertia.
 */
export function setLinkMassProperties(linkId: Id, props: MassProperties | undefined): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    if (props === undefined) {
      delete link.massProperties;
      return;
    }
    assertNonNegative(props.mass, "mass");
    assertNonNegative(props.inertia, "inertia");
    if (!props.com.every(Number.isFinite)) throw new CommandError("center of mass must be finite");
    link.massProperties = {
      mass: cleanNumber(props.mass),
      com: cleanTuple(props.com),
      inertia: cleanNumber(props.inertia),
    };
  };
}

/** Edits the document's gravity (m/s²) and/or densities (kg/m, kg/m²). Densities must be positive. */
export function setDynamicsSettings(edit: Partial<DynamicsSettings>): Recipe {
  return (draft) => {
    if (edit.gravity && !edit.gravity.every(Number.isFinite)) {
      throw new CommandError("gravity must be finite");
    }
    for (const density of [edit.barDensity, edit.plateDensity]) {
      if (density !== undefined && !(Number.isFinite(density) && density > 0)) {
        throw new CommandError("density must be positive");
      }
    }
    if (edit.gravity) draft.dynamics.gravity = cleanTuple(edit.gravity);
    if (edit.barDensity !== undefined) draft.dynamics.barDensity = edit.barDensity;
    if (edit.plateDensity !== undefined) draft.dynamics.plateDensity = edit.plateDensity;
  };
}

/** Sets what a motor does in dynamics: follow its motion, or apply an effort expression. */
export function setMotorDynamics(motorId: Id, dynamics: MotorDynamics): Recipe {
  return (draft) => {
    const motor = draft.motors.find((m) => m.id === motorId);
    if (!motor) throw new CommandError(`unknown motor "${motorId}"`);
    if (dynamics.mode === "effort" && dynamics.expression.trim().length === 0) {
      throw new CommandError("effort expression must be non-empty");
    }
    motor.dynamics =
      dynamics.mode === "motion"
        ? { mode: "motion" }
        : { mode: "effort", expression: dynamics.expression };
  };
}

export function setLinkPose(linkId: Id, pose: Pose): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    link.pose = { position: cleanTuple(pose.position), angle: cleanNumber(pose.angle) };
  };
}

/**
 * Replaces a plate's outline (link-local vertices, at least 3, all finite)
 * and its edges: one per vertex, or `undefined` for all straight.
 */
export function setPlateOutline(
  linkId: Id,
  outline: readonly Vec2Tuple[],
  edges: readonly Edge[] | undefined,
): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    if (link.shape.kind !== "plate") throw new CommandError(`link "${linkId}" is not a plate`);
    if (outline.length < 3) throw new CommandError("a plate outline needs at least 3 vertices");
    if (!outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
      throw new CommandError("plate outline vertices must be finite");
    }
    const cleaned = edges ? cleanEdges(edges, outline.length) : undefined;
    link.shape.outline = outline.map((v) => cleanTuple(v));
    if (cleaned) link.shape.edges = cleaned;
    else delete link.shape.edges;
  };
}

export interface AnnotationInput {
  id: Id;
  points: readonly Vec2Tuple[];
  color: AnnotationColor;
  width: number;
}

/** Adds a freehand annotation stroke (world points, at least one; width > 0). */
export function addAnnotation(input: AnnotationInput): Recipe {
  return (draft) => {
    if (collectDraftIds(draft).has(input.id)) throw new CommandError(`duplicate id "${input.id}"`);
    if (input.points.length === 0) throw new CommandError("a stroke needs at least one point");
    if (!input.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
      throw new CommandError("stroke points must be finite");
    }
    if (!(Number.isFinite(input.width) && input.width > 0)) {
      throw new CommandError("stroke width must be a positive number");
    }
    draft.annotations.push({
      id: input.id,
      kind: "stroke",
      points: input.points.map((p) => cleanTuple(p)),
      color: input.color,
      width: cleanNumber(input.width),
    });
  };
}

/** Removes every annotation. */
export function clearAnnotations(): Recipe {
  return (draft) => {
    draft.annotations = [];
  };
}

/** Replaces a bar's edges: one per path segment, or `undefined` for all straight. */
export function setBarEdges(linkId: Id, edges: readonly Edge[] | undefined): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    if (link.shape.kind !== "bar") throw new CommandError(`link "${linkId}" is not a bar`);
    const cleaned = edges ? cleanEdges(edges, Math.max(0, link.shape.path.length - 1)) : undefined;
    if (cleaned) link.shape.edges = cleaned;
    else delete link.shape.edges;
  };
}

export function setSiteLocal(siteId: Id, local: Vec2Tuple): Recipe {
  return (draft) => {
    const found = findSite(draft, siteId);
    if (!found) throw new CommandError(`unknown site "${siteId}"`);
    found.site.local = cleanTuple(local);
  };
}

export function rename(id: Id, name: string): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === id);
    if (link) {
      link.name = name;
      return;
    }
    const foundSite = findSite(draft, id);
    if (foundSite) {
      foundSite.site.name = name;
      return;
    }
    const joint = draft.joints.find((j) => j.id === id);
    if (joint) {
      joint.name = name;
      return;
    }
    const motor = draft.motors.find((m) => m.id === id);
    if (motor) {
      motor.name = name;
      return;
    }
    const marker = draft.markers.find((m) => m.id === id);
    if (marker) {
      marker.name = name;
      return;
    }
    const load = draft.loads.find((l) => l.id === id);
    if (load) {
      load.name = name;
      return;
    }
    const spring = draft.springs.find((s) => s.id === id);
    if (spring) {
      spring.name = name;
      return;
    }
    throw new CommandError(`unknown id "${id}"`);
  };
}

export function setUnits(length: LengthUnit): Recipe {
  return (draft) => {
    draft.units.length = length;
  };
}

/** Matches a `#RRGGBB` hex color string; the only color shape the schema/Inspector accept. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Sets (or, with `undefined`, clears) a link's `color` override. Clearing
 * deletes the property entirely so the schema round-trips (`color` is
 * `.optional()`, not nullable). Throws before mutating on an unknown link or
 * a malformed color string.
 */
export function setLinkColor(linkId: Id, color: string | undefined): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    if (color !== undefined && !HEX_COLOR_PATTERN.test(color)) {
      throw new CommandError(`invalid color "${color}"; expected "#RRGGBB"`);
    }
    if (color === undefined) {
      delete link.color;
    } else {
      link.color = color;
    }
  };
}

/** Sets a prismatic joint's slide axis (siteA-local frame). Throws on an R joint, a zero axis, or an unknown id. */
export function setJointAxis(jointId: Id, axis: Vec2Tuple): Recipe {
  return (draft) => {
    const joint = draft.joints.find((j) => j.id === jointId);
    if (!joint) throw new CommandError(`unknown joint "${jointId}"`);
    if (joint.type !== "P") {
      throw new CommandError(`joint "${jointId}" is not prismatic`);
    }
    const [ax, ay] = axis;
    if (Math.hypot(ax, ay) === 0) {
      throw new CommandError("prismatic joint axis must be non-zero");
    }
    joint.axis = cleanTuple(axis);
  };
}

/** Replaces a motor's drive. Throws on an unknown motor or an expression drive with an empty string. */
export function setMotorDrive(motorId: Id, drive: MotorDrive): Recipe {
  return (draft) => {
    const motor = draft.motors.find((m) => m.id === motorId);
    if (!motor) throw new CommandError(`unknown motor "${motorId}"`);
    if (drive.mode === "expression" && drive.expression.length === 0) {
      throw new CommandError("expression drive must be non-empty");
    }
    motor.drive =
      drive.mode === "constant"
        ? { mode: "constant", speed: cleanNumber(drive.speed) }
        : { mode: "expression", expression: drive.expression };
  };
}

/** Sets a marker's link-local coordinates. Unknown id throws (mirrors `setSiteLocal`). */
export function setMarkerLocal(markerId: Id, local: Vec2Tuple): Recipe {
  return (draft) => {
    const marker = draft.markers.find((m) => m.id === markerId);
    if (!marker) throw new CommandError(`unknown marker "${markerId}"`);
    marker.local = cleanTuple(local);
  };
}

/** Sets the document's display name (mirrors `rename`, but for the document itself). */
export function setDocumentName(name: string): Recipe {
  return (draft) => {
    draft.name = name;
  };
}

/**
 * The default drive a new motor gets from the Inspector's "Add motor" button
 * and 04-05's Motor tool: 36 deg/s for a rotary motor (stored in rad/s, the
 * document's angular convention), 10 length-units/s for a linear one.
 */
export function defaultMotorDrive(kind: "rotary" | "linear"): MotorDrive {
  return kind === "rotary"
    ? { mode: "constant", speed: degToRad(36) }
    : { mode: "constant", speed: 10 };
}

/** Moves every entity in `ids` by a world-space `delta`, in one recipe (MDL-02 batching). */
export function moveEntities(ids: ReadonlySet<Id>, delta: Vec2): Recipe {
  return (draft) => {
    const selectedLinkIds = new Set<Id>();
    for (const link of draft.links) {
      if (ids.has(link.id)) selectedLinkIds.add(link.id);
    }

    for (const link of draft.links) {
      if (selectedLinkIds.has(link.id)) {
        link.pose.position = cleanTuple([
          link.pose.position[0] + delta.x,
          link.pose.position[1] + delta.y,
        ]);
      }
    }

    for (const link of draft.links) {
      const linkSelected = selectedLinkIds.has(link.id);
      if (linkSelected) continue;
      const localDelta = rotate(delta, -link.pose.angle);
      for (const site of link.sites) {
        if (ids.has(site.id)) {
          site.local = cleanTuple([site.local[0] + localDelta.x, site.local[1] + localDelta.y]);
        }
      }
    }

    for (const marker of draft.markers) {
      if (!ids.has(marker.id)) continue;
      const link = draft.links.find((l) => l.id === marker.linkId);
      if (!link || selectedLinkIds.has(link.id)) continue;
      const localDelta = rotate(delta, -link.pose.angle);
      marker.local = cleanTuple([marker.local[0] + localDelta.x, marker.local[1] + localDelta.y]);
    }
  };
}

/**
 * Whether `site` is only an attachment point on its moving link -- added
 * for a joint or spring placed on the link's body -- rather than part of
 * the link's own geometry (a bar's path, a plate's corners).
 */
function isAttachmentSite(link: Draft<Link>, site: Draft<Site>): boolean {
  if (link.isGround) return false;
  if (link.shape.kind === "bar") return !link.shape.path.includes(site.id);
  return !link.shape.outline.some(
    ([x, y]) => Math.hypot(x - site.local[0], y - site.local[1]) <= 1e-9,
  );
}

/**
 * Deletes every entity in `ids`, cascading to whatever would otherwise
 * dangle. An attachment site (see `isAttachmentSite`) that a deleted joint
 * or spring leaves unused goes too, so deleting a pin placed on a bar's
 * middle leaves no stray point behind. Ground sites stay: a ground pivot
 * is something the user placed and can delete on its own.
 */
export function deleteEntities(ids: ReadonlySet<Id>): Recipe {
  return (draft) => {
    const linksToDelete = new Set<Id>();
    const sitesToDelete = new Set<Id>();
    const jointsToDelete = new Set<Id>();
    const motorsToDelete = new Set<Id>();
    const markersToDelete = new Set<Id>();
    const loadsToDelete = new Set<Id>();
    const springsToDelete = new Set<Id>();

    for (const link of draft.links) {
      if (ids.has(link.id)) {
        linksToDelete.add(link.id);
        for (const site of link.sites) sitesToDelete.add(site.id);
      }
    }
    for (const link of draft.links) {
      for (const site of link.sites) {
        if (ids.has(site.id)) sitesToDelete.add(site.id);
      }
    }
    for (const joint of draft.joints) {
      if (ids.has(joint.id) || sitesToDelete.has(joint.siteA) || sitesToDelete.has(joint.siteB)) {
        jointsToDelete.add(joint.id);
      }
    }
    for (const motor of draft.motors) {
      if (ids.has(motor.id) || jointsToDelete.has(motor.jointId)) {
        motorsToDelete.add(motor.id);
      }
    }
    for (const marker of draft.markers) {
      if (ids.has(marker.id) || linksToDelete.has(marker.linkId)) {
        markersToDelete.add(marker.id);
      }
    }
    for (const load of draft.loads) {
      if (ids.has(load.id) || sitesToDelete.has(load.siteId)) {
        loadsToDelete.add(load.id);
      }
    }
    for (const spring of draft.springs) {
      const dangling =
        spring.kind === "linear"
          ? sitesToDelete.has(spring.siteA) || sitesToDelete.has(spring.siteB)
          : jointsToDelete.has(spring.jointId);
      if (ids.has(spring.id) || dangling) springsToDelete.add(spring.id);
    }

    const freed = new Set<Id>();
    for (const joint of draft.joints) {
      if (jointsToDelete.has(joint.id)) freed.add(joint.siteA).add(joint.siteB);
    }
    for (const spring of draft.springs) {
      if (springsToDelete.has(spring.id) && spring.kind === "linear") {
        freed.add(spring.siteA).add(spring.siteB);
      }
    }
    const stillUsed = new Set<Id>();
    for (const joint of draft.joints) {
      if (!jointsToDelete.has(joint.id)) stillUsed.add(joint.siteA).add(joint.siteB);
    }
    for (const spring of draft.springs) {
      if (!springsToDelete.has(spring.id) && spring.kind === "linear") {
        stillUsed.add(spring.siteA).add(spring.siteB);
      }
    }
    for (const load of draft.loads) {
      if (!loadsToDelete.has(load.id)) stillUsed.add(load.siteId);
    }
    for (const link of draft.links) {
      if (linksToDelete.has(link.id)) continue;
      for (const site of link.sites) {
        if (freed.has(site.id) && !stillUsed.has(site.id) && isAttachmentSite(link, site)) {
          sitesToDelete.add(site.id);
        }
      }
    }

    draft.links = draft.links.filter((l) => !linksToDelete.has(l.id));
    for (const link of draft.links) {
      link.sites = link.sites.filter((s) => !sitesToDelete.has(s.id));
      if (link.shape.kind === "bar") {
        const oldPath = link.shape.path;
        link.shape.path = oldPath.filter((id) => !sitesToDelete.has(id));
        if (link.shape.edges) {
          // Edges between sites that stay neighbors keep their curve.
          const oldIndexOf = link.shape.path.map((id) => oldPath.indexOf(id));
          link.shape.edges = remapEdges(link.shape.edges, oldPath.length, oldIndexOf, false);
        }
      }
    }
    draft.joints = draft.joints.filter((j) => !jointsToDelete.has(j.id));
    draft.motors = draft.motors.filter((m) => !motorsToDelete.has(m.id));
    draft.markers = draft.markers.filter((m) => !markersToDelete.has(m.id));
    draft.loads = draft.loads.filter((l) => !loadsToDelete.has(l.id));
    draft.springs = draft.springs.filter((s) => !springsToDelete.has(s.id));
    draft.annotations = draft.annotations.filter((a) => !ids.has(a.id));
  };
}

export interface PlanDuplicateResult {
  recipe: Recipe;
  /** The new links' ids, in the same order as `doc.links` (not `ids`'s iteration order). */
  newLinkIds: Id[];
  /** Every duplicated entity's OLD id -> NEW id (links, their sites, and any internal joints). */
  idMap: Map<Id, Id>;
}

/**
 * Plans a Ctrl+D duplicate of the non-ground links in `ids` (any non-link id
 * in `ids`, e.g. a joint or a bare site, is ignored -- only links are ever
 * duplicated, per EDT-03). Mints every new id up front via `newId` (so the
 * recipe itself stays a deterministic, pure Immer mutation -- no id minting
 * inside `produce`), then returns ONE recipe that adds:
 *  - a copy of each selected link (new link + site ids, pose shifted by
 *    `offset`);
 *  - every "internal" joint -- one whose BOTH sites belong to a link that
 *    is itself being duplicated (a joint to a link outside the selection,
 *    e.g. the crank's joint to ground, is never copied, since the other
 *    end has no duplicate to attach to);
 *  - every motor on a duplicated (internal) joint;
 *  - every marker on a duplicated link;
 *  - every load on a duplicated site, and every spring whose ends (or
 *    joint) are all duplicated.
 * All in ONE `store.execute()` call by the caller (`effects.ts`), so a
 * duplicate is one undo step no matter how many links/joints/motors/markers
 * it carries along.
 */
export function planDuplicate(
  doc: MechanismDocument,
  ids: ReadonlySet<Id>,
  offset: Vec2,
  newId: (kind: EntityKind) => Id,
): PlanDuplicateResult {
  const linksToDuplicate = doc.links.filter((link) => ids.has(link.id) && !link.isGround);
  const duplicatedLinkIds = new Set(linksToDuplicate.map((link) => link.id));
  const idMap = new Map<Id, Id>();
  const newLinkIds: Id[] = [];
  const recipes: Recipe[] = [];

  for (const link of linksToDuplicate) {
    const newLinkId = newId("link");
    idMap.set(link.id, newLinkId);
    newLinkIds.push(newLinkId);

    const sites: SiteInput[] = link.sites.map((site) => {
      const newSiteId = newId("site");
      idMap.set(site.id, newSiteId);
      return { id: newSiteId, name: site.name, local: site.local };
    });

    recipes.push(
      addLink({
        id: newLinkId,
        name: link.name,
        isGround: false,
        ...(link.color !== undefined ? { color: link.color } : {}),
        pose: {
          position: [link.pose.position[0] + offset.x, link.pose.position[1] + offset.y],
          angle: link.pose.angle,
        },
        shape:
          link.shape.kind === "bar"
            ? {
                kind: "bar",
                path: link.shape.path.map((id) => idMap.get(id)!),
                ...(link.shape.edges ? { edges: link.shape.edges } : {}),
              }
            : link.shape,
        sites,
        ...(link.massProperties ? { massProperties: link.massProperties } : {}),
      }),
    );
  }

  const index = indexDocument(doc);

  for (const joint of doc.joints) {
    const entryA = index.sites.get(joint.siteA);
    const entryB = index.sites.get(joint.siteB);
    if (!entryA || !entryB) continue;
    if (!duplicatedLinkIds.has(entryA.link.id) || !duplicatedLinkIds.has(entryB.link.id)) continue;
    const newSiteA = idMap.get(joint.siteA);
    const newSiteB = idMap.get(joint.siteB);
    if (!newSiteA || !newSiteB) continue;
    const newJointId = newId("joint");
    idMap.set(joint.id, newJointId);
    recipes.push(
      joint.type === "P"
        ? addJoint({
            id: newJointId,
            type: "P",
            siteA: newSiteA,
            siteB: newSiteB,
            axis: joint.axis,
          })
        : addJoint({ id: newJointId, type: "R", siteA: newSiteA, siteB: newSiteB }),
    );
  }

  for (const motor of doc.motors) {
    const newJointId = idMap.get(motor.jointId);
    if (!newJointId) continue;
    const newMotorId = newId("motor");
    idMap.set(motor.id, newMotorId);
    recipes.push(
      addMotor({
        id: newMotorId,
        jointId: newJointId,
        kind: motor.kind,
        drive: motor.drive,
        dynamics: motor.dynamics,
      }),
    );
  }

  for (const load of doc.loads) {
    const newSiteId = idMap.get(load.siteId);
    if (!newSiteId) continue;
    const newLoadId = newId("load");
    idMap.set(load.id, newLoadId);
    recipes.push(
      addLoad({
        id: newLoadId,
        siteId: newSiteId,
        name: load.name,
        force: load.force,
        torque: load.torque,
      }),
    );
  }

  for (const spring of doc.springs) {
    const { id, ...rest } = spring;
    if (rest.kind === "linear") {
      const siteA = idMap.get(rest.siteA);
      const siteB = idMap.get(rest.siteB);
      if (!siteA || !siteB) continue;
      const newSpringId = newId("spring");
      idMap.set(id, newSpringId);
      recipes.push(addSpring({ ...rest, id: newSpringId, siteA, siteB }));
    } else {
      const jointId = idMap.get(rest.jointId);
      if (!jointId) continue;
      const newSpringId = newId("spring");
      idMap.set(id, newSpringId);
      recipes.push(addSpring({ ...rest, id: newSpringId, jointId }));
    }
  }

  for (const marker of doc.markers) {
    const newLinkId = idMap.get(marker.linkId);
    if (!newLinkId) continue;
    const newMarkerId = newId("marker");
    idMap.set(marker.id, newMarkerId);
    recipes.push(
      addMarker({ id: newMarkerId, linkId: newLinkId, local: marker.local, name: marker.name }),
    );
  }

  const recipe: Recipe = (draft) => {
    for (const r of recipes) r(draft);
  };

  return { recipe, newLinkIds, idMap };
}
