/**
 * Import dependencies that need the kinematics stack (09-01). `planImport`
 * (pure, `src/interchange`) receives these by injection, so the interchange
 * seam stays kinematics-free. This file is the only place the import
 * pipeline touches `createSimSession` / `computeSweep`.
 *
 * `verifyImportedDocument` measures whether an imported drawing actually
 * moves: the session's drivability verdict plus the reachable input range
 * from a sweep. The `layout` slot is `autoLayout` (09-02).
 */

import type { ImportDeps, MobilityVerdict } from "../interchange/importReport";
import type { MechanismDocument } from "../model";
import { autoLayout } from "./autoLayout";
import { createSimSession } from "./session";
import { computeSweep } from "./sweep";

/** Rotary sweep step used for the mobility measurement (2 degrees). */
const ROTARY_STEP = (2 * Math.PI) / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Never emit `Infinity` or `NaN`. */
export function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Classifies `doc` and, when it is `ready`, sweeps its driven input:
 * rotary -> reachable range in degrees (360 for a full rotation), linear
 * -> travel in model units (`rangeDeg` 0). Every number in the result is
 * finite.
 */
export function verifyImportedDocument(doc: MechanismDocument): MobilityVerdict {
  const session = createSimSession(doc);
  const { summary } = session;
  const base: MobilityVerdict = {
    status: summary.status,
    gruebler: summary.gruebler,
    rankDof: summary.rankDof,
    inputKind: summary.inputKind,
    rangeDeg: 0,
    linearTravel: null,
    fullRotation: false,
  };
  if (summary.status !== "ready" || !session.system || !session.start || session.motorIndex < 0) {
    return base;
  }

  const sweep = computeSweep(session.system, session.start, session.motorIndex, {
    rotaryStep: ROTARY_STEP,
  });
  const span = finiteOrZero(sweep.inputMax - sweep.inputMin);
  if (summary.inputKind === "linear") {
    return { ...base, linearTravel: span };
  }
  const fullRotation = sweep.kind === "full-rotation";
  return {
    ...base,
    rangeDeg: fullRotation ? 360 : Math.min(360, span * RAD_TO_DEG),
    fullRotation,
  };
}

/** The real dependencies for `planImport`: real verification plus the seeded auto-layout. */
export const studioImportDeps: ImportDeps = { verify: verifyImportedDocument, layout: autoLayout };
