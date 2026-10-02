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
  type LinkShape,
  type Pose,
  type MotorDrive,
  type LengthUnit,
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
  shape?: LinkShape;
  sites: SiteInput[];
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
  return ids;
}

/** Finds a site and its owning link by site id, or undefined if not found. */
function findSite(doc: DraftDoc, id: Id): { site: DraftSite; link: DraftLink } | undefined {
  for (const link of doc.links) {
    const site = link.sites.find((s) => s.id === id);
    if (site) return { site, link };
  }
  return undefined;
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
      shape: input.shape ?? { kind: "bar" },
      sites: input.sites.map((s) => ({
        id: s.id,
        name: s.name ?? "",
        local: cleanTuple(s.local),
      })),
    });
  };
}

export function addSite(linkId: Id, site: SiteInput): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    const ids = collectDraftIds(draft);
    if (ids.has(site.id)) throw new CommandError(`duplicate id "${site.id}"`);
    link.sites.push({ id: site.id, name: site.name ?? "", local: cleanTuple(site.local) });
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

export function setLinkPose(linkId: Id, pose: Pose): Recipe {
  return (draft) => {
    const link = draft.links.find((l) => l.id === linkId);
    if (!link) throw new CommandError(`unknown link "${linkId}"`);
    link.pose = { position: cleanTuple(pose.position), angle: cleanNumber(pose.angle) };
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

/** Deletes every entity in `ids`, cascading to whatever would otherwise dangle. */
export function deleteEntities(ids: ReadonlySet<Id>): Recipe {
  return (draft) => {
    const linksToDelete = new Set<Id>();
    const sitesToDelete = new Set<Id>();
    const jointsToDelete = new Set<Id>();
    const motorsToDelete = new Set<Id>();
    const markersToDelete = new Set<Id>();
    const loadsToDelete = new Set<Id>();

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

    draft.links = draft.links.filter((l) => !linksToDelete.has(l.id));
    for (const link of draft.links) {
      link.sites = link.sites.filter((s) => !sitesToDelete.has(s.id));
    }
    draft.joints = draft.joints.filter((j) => !jointsToDelete.has(j.id));
    draft.motors = draft.motors.filter((m) => !motorsToDelete.has(m.id));
    draft.markers = draft.markers.filter((m) => !markersToDelete.has(m.id));
    draft.loads = draft.loads.filter((l) => !loadsToDelete.has(l.id));
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
 *  - every marker on a duplicated link.
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
        shape: link.shape,
        sites,
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
      addMotor({ id: newMotorId, jointId: newJointId, kind: motor.kind, drive: motor.drive }),
    );
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
