/**
 * `compileSystem(doc)`: turns a `MechanismDocument` into a `KinematicSystem`
 * — the compiled, allocation-free-at-solve-time representation every other
 * module in `src/kinematics` operates on. This is the expensive, rare step
 * (topology analysis); `position.ts`'s `newtonSolve`/`solvePosition` are the
 * cheap, frequent ones that only touch this compiled form, never `doc`
 * directly (Pitfall 4).
 */

import { rotate, perp, normalize, add, sub, vec2, distance, type Vec2 } from "../geom";
import { indexDocument, type MechanismDocument } from "../model";
import { KinematicsError } from "./errors";
import { ExpressionError } from "./expression";
import { compileDrive, type DriveFunction } from "./drives";
import { createLinalgWorkspace, type LinalgWorkspace } from "./linalg";
import type { CompiledConstraint } from "./constraints";

/** A compiled link: its id/name/ground flag, its index into `q` (or -1 for ground), and its fixed reference pose. */
export interface LinkSlot {
  readonly id: string;
  readonly name: string;
  readonly isGround: boolean;
  readonly offset: number;
  readonly reference: { readonly x: number; readonly y: number; readonly angle: number };
}

/** A resolved site: which compiled link it belongs to, and its link-local coordinates. */
export interface SiteRef {
  readonly linkIndex: number;
  readonly local: { readonly x: number; readonly y: number };
}

/** A compiled motor: its driver row and compiled drive function (null if its expression is invalid). */
export interface CompiledMotor {
  readonly id: string;
  readonly label: string;
  readonly jointId: string;
  readonly kind: "rotary" | "linear";
  readonly row: number;
  readonly drive: DriveFunction | null;
}

/** A non-fatal problem discovered while compiling the system (currently: an invalid motor expression). */
export type SystemIssue = {
  readonly code: "invalid-expression";
  readonly motorId: string;
  readonly message: string;
};

/** A compiled marker: which link it rides on, and its link-local coordinates. */
export interface CompiledMarker {
  readonly id: string;
  readonly label: string;
  readonly linkIndex: number;
  readonly local: { readonly x: number; readonly y: number };
}

/** Preallocated per-system scratch buffers for `position.ts`'s Newton loop. A `KinematicSystem` is not re-entrant. */
export interface SolverWorkspace {
  readonly r: Float64Array;
  readonly rTrial: Float64Array;
  readonly J: Float64Array;
  readonly qTrial: Float64Array;
  readonly dx: Float64Array;
  readonly linalg: LinalgWorkspace;
}

/** The compiled kinematic system: everything `constraints.ts`/`position.ts`/`drives.ts` need, built once per document. */
export interface KinematicSystem {
  readonly links: readonly LinkSlot[];
  readonly linkIndexById: ReadonlyMap<string, number>;
  readonly sites: ReadonlyMap<string, SiteRef>;
  readonly markers: readonly CompiledMarker[];
  readonly n: number;
  readonly jointRows: number;
  readonly m: number;
  readonly constraints: readonly CompiledConstraint[];
  readonly motors: readonly CompiledMotor[];
  readonly q0: Float64Array;
  readonly lengthScale: number;
  readonly issues: readonly SystemIssue[];
  readonly workspace: SolverWorkspace;
}

/** Compiles a `MechanismDocument` into a `KinematicSystem`. Throws `KinematicsError` for a dangling site/joint reference; never throws for an invalid motor expression (recorded as an issue instead). */
export function compileSystem(doc: MechanismDocument): KinematicSystem {
  const index = indexDocument(doc);

  // 1. Link slots: moving links get 3 consecutive q-slots in document order; ground links get offset -1.
  const links: LinkSlot[] = [];
  const linkIndexById = new Map<string, number>();
  let nextOffset = 0;
  doc.links.forEach((link, i) => {
    const offset = link.isGround ? -1 : nextOffset;
    if (!link.isGround) nextOffset += 3;
    links.push({
      id: link.id,
      name: link.name,
      isGround: link.isGround,
      offset,
      reference: { x: link.pose.position[0], y: link.pose.position[1], angle: link.pose.angle },
    });
    linkIndexById.set(link.id, i);
  });
  const n = nextOffset;

  // 2. Sites, resolved to a compiled link index + local coordinates.
  const sites = new Map<string, SiteRef>();
  for (const link of doc.links) {
    const linkIndex = linkIndexById.get(link.id)!;
    for (const site of link.sites) {
      sites.set(site.id, { linkIndex, local: { x: site.local[0], y: site.local[1] } });
    }
  }
  const resolveSite = (siteId: string): SiteRef => {
    const ref = sites.get(siteId);
    if (!ref) throw new KinematicsError("unknown-site", `unknown site id "${siteId}"`);
    return ref;
  };

  // 3. q0: the authored reference pose.
  const q0 = new Float64Array(n);
  for (const slot of links) {
    if (slot.offset < 0) continue;
    q0[slot.offset] = slot.reference.x;
    q0[slot.offset + 1] = slot.reference.y;
    q0[slot.offset + 2] = slot.reference.angle;
  }

  // 4. Joint constraints (2 rows each, in doc.joints order).
  const jointRows = doc.joints.length * 2;
  const constraints: CompiledConstraint[] = [];
  doc.joints.forEach((joint, i) => {
    const row = i * 2;
    const a = resolveSite(joint.siteA);
    const b = resolveSite(joint.siteB);
    const label = joint.name || joint.id;

    if (joint.type === "R") {
      constraints.push({ kind: "revolute", jointId: joint.id, label, row, a, b });
      return;
    }

    const axisLocal = normalize(vec2(joint.axis[0], joint.axis[1]));
    const normalLocal = perp(axisLocal);
    const angleI = links[a.linkIndex].reference.angle;
    const angleJ = links[b.linkIndex].reference.angle;
    constraints.push({
      kind: "prismatic",
      jointId: joint.id,
      label,
      row,
      a,
      b,
      axisLocal: { x: axisLocal.x, y: axisLocal.y },
      normalLocal: { x: normalLocal.x, y: normalLocal.y },
      dThetaRef: angleJ - angleI,
    });
  });

  // 5. Motors: compiled drive + issue (never throws for a bad expression) + driver row.
  const jointById = index.joints;
  const issues: SystemIssue[] = [];
  const motors: CompiledMotor[] = [];
  doc.motors.forEach((motor, k) => {
    const joint = jointById.get(motor.jointId);
    if (!joint) throw new KinematicsError("unknown-joint", `unknown joint id "${motor.jointId}"`);
    const row = jointRows + k;
    const label = motor.name || motor.id;

    let drive: DriveFunction | null;
    try {
      drive = compileDrive(motor.drive);
    } catch (err) {
      if (!(err instanceof ExpressionError)) throw err;
      issues.push({ code: "invalid-expression", motorId: motor.id, message: err.message });
      drive = null;
    }
    motors.push({ id: motor.id, label, jointId: motor.jointId, kind: motor.kind, row, drive });

    if (motor.kind === "rotary") {
      const a = resolveSite(joint.siteA);
      const b = resolveSite(joint.siteB);
      const angleI = links[a.linkIndex].reference.angle;
      const angleJ = links[b.linkIndex].reference.angle;
      constraints.push({
        kind: "rotary-driver",
        motorId: motor.id,
        jointId: joint.id,
        label,
        row,
        motorIndex: k,
        linkA: a.linkIndex,
        linkB: b.linkIndex,
        dThetaRef: angleJ - angleI,
      });
      return;
    }

    if (joint.type !== "P") {
      throw new KinematicsError(
        "unknown-joint",
        `linear motor "${motor.id}" requires a prismatic joint`,
      );
    }
    const a = resolveSite(joint.siteA);
    const b = resolveSite(joint.siteB);
    const axisLocal = normalize(vec2(joint.axis[0], joint.axis[1]));
    const angleI = links[a.linkIndex].reference.angle;
    const angleJ = links[b.linkIndex].reference.angle;
    const refA = add(
      rotate(vec2(a.local.x, a.local.y), angleI),
      vec2(links[a.linkIndex].reference.x, links[a.linkIndex].reference.y),
    );
    const refB = add(
      rotate(vec2(b.local.x, b.local.y), angleJ),
      vec2(links[b.linkIndex].reference.x, links[b.linkIndex].reference.y),
    );
    const dRef = sub(refB, refA);
    const axisWorldRef = rotate(axisLocal, angleI);
    const refDist = axisWorldRef.x * dRef.x + axisWorldRef.y * dRef.y;
    constraints.push({
      kind: "linear-driver",
      motorId: motor.id,
      jointId: joint.id,
      label,
      row,
      motorIndex: k,
      a,
      b,
      axisLocal: { x: axisLocal.x, y: axisLocal.y },
      refDist,
    });
  });

  const m = jointRows + doc.motors.length;

  // 6. Markers.
  const markers: CompiledMarker[] = doc.markers.map((marker) => {
    const linkIndex = linkIndexById.get(marker.linkId);
    if (linkIndex === undefined) {
      throw new KinematicsError(
        "unknown-site",
        `unknown link id "${marker.linkId}" for marker "${marker.id}"`,
      );
    }
    return {
      id: marker.id,
      label: marker.name || marker.id,
      linkIndex,
      local: { x: marker.local[0], y: marker.local[1] },
    };
  });

  // 7. Length scale: max pairwise distance between any two site world positions at reference, >= 1.
  const siteWorldPoints: Vec2[] = [];
  for (const link of doc.links) {
    const origin = vec2(link.pose.position[0], link.pose.position[1]);
    for (const site of link.sites) {
      siteWorldPoints.push(
        add(rotate(vec2(site.local[0], site.local[1]), link.pose.angle), origin),
      );
    }
  }
  let lengthScale = 1;
  for (let i = 0; i < siteWorldPoints.length; i++) {
    for (let j = i + 1; j < siteWorldPoints.length; j++) {
      const d = distance(siteWorldPoints[i], siteWorldPoints[j]);
      if (d > lengthScale) lengthScale = d;
    }
  }

  // 8. Workspace: every buffer position.ts's Newton loop needs, preallocated once.
  const workspace: SolverWorkspace = {
    r: new Float64Array(m),
    rTrial: new Float64Array(m),
    J: new Float64Array(m * n),
    qTrial: new Float64Array(n),
    dx: new Float64Array(n),
    linalg: createLinalgWorkspace(n),
  };

  return {
    links,
    linkIndexById,
    sites,
    markers,
    n,
    jointRows,
    m,
    constraints,
    motors,
    q0,
    lengthScale,
    issues,
    workspace,
  };
}

/** The world pose `(x, y, angle)` of a link at the given `q`. Ground links return their fixed reference pose. */
export function linkPose(
  system: KinematicSystem,
  q: Float64Array,
  linkIndex: number,
): { x: number; y: number; angle: number } {
  const slot = system.links[linkIndex];
  if (slot.offset < 0) {
    return { x: slot.reference.x, y: slot.reference.y, angle: slot.reference.angle };
  }
  return { x: q[slot.offset], y: q[slot.offset + 1], angle: q[slot.offset + 2] };
}
