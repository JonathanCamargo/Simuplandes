/**
 * Turns `ToolEffect`s into store mutations: for each effect, ALL its recipes
 * are gathered and run in exactly ONE `store.execute(label, recipes)` call
 * (decision 6) -- an auto-pinned bar/plate/slider and its joints/ground site
 * are one undo step, never two. Machines never call this directly; the
 * `src/tools/react` controller does, one call per commit effect.
 */

import { rotate, fromPolar, type Vec2 } from "../geom";
import {
  poseFromWorldPoints,
  worldToLinkLocal,
  type EntityKind,
  type Id,
  type MechanismDocument,
  type Pose,
} from "../model";
import {
  addLink,
  addSite,
  addJoint,
  addMotor,
  addMarker,
  moveEntities,
  planDuplicate,
  defaultMotorDrive,
  type Recipe,
} from "../store/commands";
import type { MechanismStore } from "../store";
import type { ToolEffect } from "./types";

export interface DefaultNames {
  bar: string;
  plate: string;
  ground: string;
  slider: string;
  marker: string;
}

export interface ApplyToolEffectsOptions {
  defaultNames: DefaultNames;
}

export interface CommitResult {
  linkId?: Id;
  siteIds: Id[];
  createdIds: Id[];
}

const IDENTITY_POSE: Pose = { position: [0, 0], angle: 0 };

/** The next `"{base} N"` name, N = 1 + how many existing links already use that base. */
function nextIndexedName(doc: MechanismDocument, base: string): string {
  const count = doc.links.filter((l) => l.name === base || l.name.startsWith(`${base} `)).length;
  return `${base} ${count + 1}`;
}

/** Same as `nextIndexedName`, but counting existing MARKERS instead of links. */
function nextIndexedMarkerName(doc: MechanismDocument, base: string): string {
  const count = doc.markers.filter((m) => m.name === base || m.name.startsWith(`${base} `)).length;
  return `${base} ${count + 1}`;
}

/**
 * Resolves (or creates) the document's ground link and adds a new ground
 * site at world point `at`. Shared by `commitGroundPivot` and
 * `commitSlider`, both of which may need a brand-new ground link+site in
 * the SAME commit as everything else they create.
 */
function groundSiteStep(
  doc: MechanismDocument,
  at: Vec2,
  idFactory: (kind: "link" | "site" | "joint") => Id,
  defaultNames: DefaultNames,
  recipes: Recipe[],
): { groundLinkId: Id; groundSiteId: Id; groundPose: Pose; createdLink: boolean } {
  const groundSiteId = idFactory("site");
  const existing = doc.links.find((l) => l.isGround);
  if (existing) {
    recipes.push(
      addSite(existing.id, { id: groundSiteId, local: worldToLinkLocal(existing.pose, at) }),
    );
    return {
      groundLinkId: existing.id,
      groundSiteId,
      groundPose: existing.pose,
      createdLink: false,
    };
  }
  const groundLinkId = idFactory("link");
  recipes.push(
    addLink({
      id: groundLinkId,
      name: defaultNames.ground,
      isGround: true,
      pose: IDENTITY_POSE,
      sites: [{ id: groundSiteId, local: worldToLinkLocal(IDENTITY_POSE, at) }],
    }),
  );
  return { groundLinkId, groundSiteId, groundPose: IDENTITY_POSE, createdLink: true };
}

function buildCommitBar(
  effect: Extract<ToolEffect, { kind: "commitBar" }>,
  doc: MechanismDocument,
  idFactory: (kind: "link" | "site" | "joint") => Id,
  defaultNames: DefaultNames,
): { label: string; recipes: Recipe[]; result: CommitResult } {
  const linkId = idFactory("link");
  const siteAId = idFactory("site");
  const siteBId = idFactory("site");
  const recipes: Recipe[] = [
    addLink({
      id: linkId,
      name: nextIndexedName(doc, defaultNames.bar),
      shape: { kind: "bar" },
      pose: { position: [effect.start.x, effect.start.y], angle: effect.angle },
      sites: [
        { id: siteAId, local: [0, 0] },
        { id: siteBId, local: [effect.length, 0] },
      ],
    }),
  ];
  const createdIds: Id[] = [linkId, siteAId, siteBId];
  if (effect.startSiteId) {
    const jointId = idFactory("joint");
    recipes.push(addJoint({ id: jointId, type: "R", siteA: siteAId, siteB: effect.startSiteId }));
    createdIds.push(jointId);
  }
  if (effect.endSiteId) {
    const jointId = idFactory("joint");
    recipes.push(addJoint({ id: jointId, type: "R", siteA: siteBId, siteB: effect.endSiteId }));
    createdIds.push(jointId);
  }
  return {
    label: "draw-bar",
    recipes,
    result: { linkId, siteIds: [siteAId, siteBId], createdIds },
  };
}

function buildCommitPlate(
  effect: Extract<ToolEffect, { kind: "commitPlate" }>,
  doc: MechanismDocument,
  idFactory: (kind: "link" | "site" | "joint") => Id,
  defaultNames: DefaultNames,
): { label: string; recipes: Recipe[]; result: CommitResult } {
  const linkId = idFactory("link");
  const siteIds = effect.vertices.map(() => idFactory("site"));
  const pose = poseFromWorldPoints(effect.vertices[0], effect.vertices[1]);
  const outline = effect.vertices.map((v) => worldToLinkLocal(pose, v));
  const recipes: Recipe[] = [
    addLink({
      id: linkId,
      name: nextIndexedName(doc, defaultNames.plate),
      shape: { kind: "plate", outline },
      pose,
      sites: siteIds.map((id, i) => ({ id, local: outline[i] })),
    }),
  ];
  const createdIds: Id[] = [linkId, ...siteIds];
  effect.vertexSiteIds.forEach((existingSiteId, i) => {
    if (!existingSiteId) return;
    const jointId = idFactory("joint");
    recipes.push(addJoint({ id: jointId, type: "R", siteA: siteIds[i], siteB: existingSiteId }));
    createdIds.push(jointId);
  });
  return { label: "draw-plate", recipes, result: { linkId, siteIds, createdIds } };
}

function buildCommitGroundPivot(
  effect: Extract<ToolEffect, { kind: "commitGroundPivot" }>,
  doc: MechanismDocument,
  idFactory: (kind: "link" | "site" | "joint") => Id,
  defaultNames: DefaultNames,
): { label: string; recipes: Recipe[]; result: CommitResult } {
  const recipes: Recipe[] = [];
  const { groundLinkId, groundSiteId, createdLink } = groundSiteStep(
    doc,
    effect.at,
    idFactory,
    defaultNames,
    recipes,
  );
  const createdIds: Id[] = createdLink ? [groundLinkId, groundSiteId] : [groundSiteId];
  if (effect.siteId) {
    const jointId = idFactory("joint");
    recipes.push(addJoint({ id: jointId, type: "R", siteA: groundSiteId, siteB: effect.siteId }));
    createdIds.push(jointId);
  }
  return {
    label: "add-ground-pivot",
    recipes,
    result: { linkId: groundLinkId, siteIds: [groundSiteId], createdIds },
  };
}

function buildCommitPin(
  effect: Extract<ToolEffect, { kind: "commitPin" }>,
  idFactory: (kind: "link" | "site" | "joint") => Id,
): { label: string; recipes: Recipe[]; result: CommitResult } {
  const jointId = idFactory("joint");
  const recipes: Recipe[] = [
    addJoint({ id: jointId, type: "R", siteA: effect.siteA, siteB: effect.siteB }),
  ];
  return {
    label: "add-pin",
    recipes,
    result: { siteIds: [effect.siteA, effect.siteB], createdIds: [jointId] },
  };
}

function buildCommitSlider(
  effect: Extract<ToolEffect, { kind: "commitSlider" }>,
  doc: MechanismDocument,
  idFactory: (kind: "link" | "site" | "joint") => Id,
  defaultNames: DefaultNames,
): { label: string; recipes: Recipe[]; result: CommitResult } {
  const recipes: Recipe[] = [];
  const blockLinkId = idFactory("link");
  const blockSiteId = idFactory("site");
  const h = effect.blockHalfSize;
  const h2 = h / 2;
  recipes.push(
    addLink({
      id: blockLinkId,
      name: nextIndexedName(doc, defaultNames.slider),
      shape: {
        kind: "plate",
        outline: [
          [-h, -h2],
          [h, -h2],
          [h, h2],
          [-h, h2],
        ],
      },
      pose: { position: [effect.at.x, effect.at.y], angle: effect.axisAngle },
      sites: [{ id: blockSiteId, local: [0, 0] }],
    }),
  );

  const { groundLinkId, groundSiteId, groundPose, createdLink } = groundSiteStep(
    doc,
    effect.at,
    idFactory,
    defaultNames,
    recipes,
  );

  const axisWorld = fromPolar(1, effect.axisAngle);
  const axisLocal = rotate(axisWorld, -groundPose.angle);

  const pJointId = idFactory("joint");
  recipes.push(
    addJoint({
      id: pJointId,
      type: "P",
      siteA: groundSiteId,
      siteB: blockSiteId,
      axis: [axisLocal.x, axisLocal.y],
    }),
  );

  const createdIds: Id[] = createdLink
    ? [blockLinkId, blockSiteId, groundLinkId, groundSiteId, pJointId]
    : [blockLinkId, blockSiteId, groundSiteId, pJointId];

  if (effect.siteId) {
    const rJointId = idFactory("joint");
    recipes.push(addJoint({ id: rJointId, type: "R", siteA: blockSiteId, siteB: effect.siteId }));
    createdIds.push(rJointId);
  }

  return {
    label: "add-slider",
    recipes,
    result: { linkId: blockLinkId, siteIds: [blockSiteId, groundSiteId], createdIds },
  };
}

const NO_ENTITIES_RESULT: CommitResult = { siteIds: [], createdIds: [] };

/**
 * Applies each effect, in order, and returns the ids each one created (or
 * `NO_ENTITIES_RESULT` for an effect that creates nothing, e.g. a selection
 * change). Every "commit"-style effect (draw/connect/move/delete/duplicate/
 * addMotor/addMarker) runs as its OWN single `store.execute()` call -- one
 * undo step per commit, however many recipes it bundles. `select`/
 * `clearSelection` go straight to `store.select`/`clearSelection` instead:
 * selection is never part of undo history (by design).
 */
export function applyToolEffects(
  store: MechanismStore,
  effects: readonly ToolEffect[],
  options: ApplyToolEffectsOptions,
): CommitResult[] {
  const idFactory = (kind: EntityKind): Id => store.getState().newId(kind);
  const results: CommitResult[] = [];

  for (const effect of effects) {
    switch (effect.kind) {
      case "commitBar": {
        const built = buildCommitBar(
          effect,
          store.getState().document,
          idFactory,
          options.defaultNames,
        );
        store.getState().execute(built.label, built.recipes);
        results.push(built.result);
        break;
      }
      case "commitPlate": {
        const built = buildCommitPlate(
          effect,
          store.getState().document,
          idFactory,
          options.defaultNames,
        );
        store.getState().execute(built.label, built.recipes);
        results.push(built.result);
        break;
      }
      case "commitGroundPivot": {
        const built = buildCommitGroundPivot(
          effect,
          store.getState().document,
          idFactory,
          options.defaultNames,
        );
        store.getState().execute(built.label, built.recipes);
        results.push(built.result);
        break;
      }
      case "commitPin": {
        const built = buildCommitPin(effect, idFactory);
        store.getState().execute(built.label, built.recipes);
        results.push(built.result);
        break;
      }
      case "commitSlider": {
        const built = buildCommitSlider(
          effect,
          store.getState().document,
          idFactory,
          options.defaultNames,
        );
        store.getState().execute(built.label, built.recipes);
        results.push(built.result);
        break;
      }
      case "select": {
        store.getState().select(effect.ids, effect.mode);
        results.push(NO_ENTITIES_RESULT);
        break;
      }
      case "clearSelection": {
        store.getState().clearSelection();
        results.push(NO_ENTITIES_RESULT);
        break;
      }
      case "moveEntities": {
        store.getState().execute(effect.label, moveEntities(new Set(effect.ids), effect.delta), {
          coalesceKey: effect.gestureId,
        });
        results.push({ siteIds: effect.ids, createdIds: [] });
        break;
      }
      case "deleteSelection": {
        store.getState().deleteSelection();
        results.push(NO_ENTITIES_RESULT);
        break;
      }
      case "duplicateSelection": {
        const { recipe, newLinkIds } = planDuplicate(
          store.getState().document,
          store.getState().selection,
          effect.offset,
          idFactory,
        );
        store.getState().execute("duplicate-selection", recipe);
        store.getState().select(newLinkIds);
        results.push({ siteIds: [], createdIds: newLinkIds });
        break;
      }
      case "addMotor": {
        const id = idFactory("motor");
        store.getState().execute(
          "add-motor",
          addMotor({
            id,
            jointId: effect.jointId,
            kind: effect.motorKind,
            drive: defaultMotorDrive(effect.motorKind),
          }),
        );
        results.push({ siteIds: [], createdIds: [id] });
        break;
      }
      case "addMarker": {
        const id = idFactory("marker");
        const name = nextIndexedMarkerName(store.getState().document, options.defaultNames.marker);
        store
          .getState()
          .execute(
            "add-marker",
            addMarker({ id, linkId: effect.linkId, local: effect.local, name }),
          );
        results.push({ siteIds: [], createdIds: [id] });
        break;
      }
    }
  }

  return results;
}
