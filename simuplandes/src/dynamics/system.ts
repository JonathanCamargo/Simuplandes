/**
 * `compileDynamics(doc, kin)`: the dynamics layer over a compiled
 * `KinematicSystem`. The kinematic system supplies the constraints (joints
 * plus the motion-driven motors); this adds what dynamics needs on top:
 * mass properties, gravity, loads, springs and effort motors.
 *
 * Units. The kinematic coordinates are model units (x, y) and radians.
 * Dynamics works in SI: `colScale[i]` converts a coordinate to SI
 * (metersPerUnit for x and y, 1 for an angle), and `rowScale[r]` converts a
 * constraint row's residual to SI (metersPerUnit for a length row, 1 for an
 * angle row). With those, an SI Jacobian entry is
 * `J[r][c] * rowScale[r] / colScale[c]`. Lagrange multipliers come out in N
 * for length rows and N·m for angle rows.
 */

import { compileExpression, ExpressionError, type KinematicSystem } from "../kinematics";
import {
  indexDocument,
  metersPerUnit,
  resolveMassProperties,
  type MechanismDocument,
} from "../model";
import { jointCoordinateOf, type AngleCoordinate, type JointCoordinate } from "./coordinates";

/** A moving link's inertia: mass (kg), center of mass (link-local, model units) and inertia about it (kg·m²). */
export interface Body {
  readonly linkIndex: number;
  readonly offset: number;
  readonly mass: number;
  readonly com: { readonly x: number; readonly y: number };
  readonly inertia: number;
}

/** A constant force (N, world) and torque (N·m) on a link-local point of a moving link. */
export interface PointLoad {
  readonly id: string;
  readonly linkIndex: number;
  readonly local: { readonly x: number; readonly y: number };
  readonly fx: number;
  readonly fy: number;
  readonly torque: number;
}

/** A compiled linear spring-damper. `freeLength` is in meters. */
export interface LinearSpringElement {
  readonly id: string;
  readonly label: string;
  readonly a: { readonly linkIndex: number; readonly local: { x: number; y: number } };
  readonly b: { readonly linkIndex: number; readonly local: { x: number; y: number } };
  readonly stiffness: number;
  readonly damping: number;
  readonly freeLength: number;
}

/** A compiled torsional spring-damper on a revolute joint's relative angle. */
export interface TorsionalSpringElement {
  readonly id: string;
  readonly label: string;
  readonly coord: AngleCoordinate;
  readonly stiffness: number;
  readonly damping: number;
  readonly freeAngle: number;
}

/** An effort motor: an expression in `t`, `q`, `dq` giving a torque (N·m) or force (N) along a joint coordinate. */
export interface Actuator {
  readonly motorId: string;
  readonly label: string;
  readonly kind: "rotary" | "linear";
  readonly coord: JointCoordinate;
  readonly evaluate: ((t: number, q: number, dq: number) => number) | null;
}

/** A non-fatal problem found while compiling (an effort expression that does not parse). */
export interface DynamicsIssue {
  readonly code: "invalid-effort-expression";
  readonly motorId: string;
  readonly message: string;
}

/** Preallocated buffers for the solves. A `DynamicSystem` is not re-entrant. */
export interface DynamicsWorkspace {
  readonly M: Float64Array;
  readonly Q: Float64Array;
  readonly J: Float64Array;
  readonly rhs: Float64Array;
  readonly K: Float64Array;
  readonly x: Float64Array;
  readonly piv: Int32Array;
  readonly K2: Float64Array;
  readonly grad: Float64Array;
  readonly vSI: Float64Array;
}

export interface DynamicSystem {
  readonly kin: KinematicSystem;
  readonly metersPerUnit: number;
  readonly gravity: { readonly x: number; readonly y: number };
  readonly bodies: readonly Body[];
  readonly loads: readonly PointLoad[];
  readonly linearSprings: readonly LinearSpringElement[];
  readonly torsionalSprings: readonly TorsionalSpringElement[];
  readonly actuators: readonly Actuator[];
  /** The joint coordinate of each motion driver, indexed like `kin.motors`. */
  readonly driverCoordinates: readonly JointCoordinate[];
  readonly colScale: Float64Array;
  readonly rowScale: Float64Array;
  readonly issues: readonly DynamicsIssue[];
  readonly workspace: DynamicsWorkspace;
}

/** The free variables of an effort expression, in `evaluateWith` order. */
export const EFFORT_VARIABLES: readonly string[] = ["t", "q", "dq"];

export interface CompileDynamicsOptions {
  /**
   * Whether effort-mode motors that are not kinematic drivers apply their
   * effort. Kinematic simulation passes false: there every motor follows
   * its motion and dynamics only reports the forces that motion needs.
   */
  readonly efforts?: boolean;
}

/**
 * Compiles the dynamics of `doc` over `kin`, which must have been compiled
 * from `doc` (or from a copy that differs only in its motors). Never throws
 * for a bad effort expression; that motor is recorded in `issues` and
 * applies no effort.
 */
export function compileDynamics(
  doc: MechanismDocument,
  kin: KinematicSystem,
  options: CompileDynamicsOptions = {},
): DynamicSystem {
  const index = indexDocument(doc);
  const scale = metersPerUnit(doc.units.length);
  const n = kin.n;
  const m = kin.m;

  const bodies: Body[] = [];
  kin.links.forEach((slot, linkIndex) => {
    if (slot.offset < 0) return;
    const props = resolveMassProperties(index.links.get(slot.id)!, doc);
    bodies.push({
      linkIndex,
      offset: slot.offset,
      mass: props.mass,
      com: { x: props.com[0], y: props.com[1] },
      inertia: props.inertia,
    });
  });

  const loads: PointLoad[] = [];
  for (const load of doc.loads) {
    const site = kin.sites.get(load.siteId);
    if (!site || kin.links[site.linkIndex].offset < 0) continue;
    loads.push({
      id: load.id,
      linkIndex: site.linkIndex,
      local: site.local,
      fx: load.force[0],
      fy: load.force[1],
      torque: load.torque,
    });
  }

  const linearSprings: LinearSpringElement[] = [];
  const torsionalSprings: TorsionalSpringElement[] = [];
  for (const spring of doc.springs) {
    const label = spring.name || spring.id;
    if (spring.kind === "linear") {
      const a = kin.sites.get(spring.siteA)!;
      const b = kin.sites.get(spring.siteB)!;
      linearSprings.push({
        id: spring.id,
        label,
        a: { linkIndex: a.linkIndex, local: { ...a.local } },
        b: { linkIndex: b.linkIndex, local: { ...b.local } },
        stiffness: spring.stiffness,
        damping: spring.damping,
        freeLength: spring.freeLength * scale,
      });
    } else {
      const joint = index.joints.get(spring.jointId)!;
      torsionalSprings.push({
        id: spring.id,
        label,
        coord: jointCoordinateOf(kin, joint) as AngleCoordinate,
        stiffness: spring.stiffness,
        damping: spring.damping,
        freeAngle: spring.freeAngle,
      });
    }
  }

  const drivenMotorIds = new Set(kin.motors.map((motor) => motor.id));
  const actuators: Actuator[] = [];
  const issues: DynamicsIssue[] = [];
  if (options.efforts) {
    for (const motor of doc.motors) {
      if (motor.dynamics.mode !== "effort" || drivenMotorIds.has(motor.id)) continue;
      const joint = index.joints.get(motor.jointId)!;
      let evaluate: Actuator["evaluate"] = null;
      try {
        const compiled = compileExpression(motor.dynamics.expression, EFFORT_VARIABLES);
        const vars = new Float64Array(3);
        evaluate = (t, q, dq) => {
          vars[0] = t;
          vars[1] = q;
          vars[2] = dq;
          return compiled.evaluateWith(vars);
        };
      } catch (err) {
        if (!(err instanceof ExpressionError)) throw err;
        issues.push({ code: "invalid-effort-expression", motorId: motor.id, message: err.message });
      }
      actuators.push({
        motorId: motor.id,
        label: motor.name || joint.name || joint.id,
        kind: motor.kind,
        coord: jointCoordinateOf(kin, joint),
        evaluate,
      });
    }
  }

  const driverCoordinates = kin.motors.map((motor) =>
    jointCoordinateOf(kin, index.joints.get(motor.jointId)!),
  );

  const colScale = new Float64Array(n);
  for (let i = 0; i < n; i += 3) {
    colScale[i] = scale;
    colScale[i + 1] = scale;
    colScale[i + 2] = 1;
  }
  const rowScale = new Float64Array(m);
  for (const c of kin.constraints) {
    switch (c.kind) {
      case "revolute":
        rowScale[c.row] = scale;
        rowScale[c.row + 1] = scale;
        break;
      case "prismatic":
        rowScale[c.row] = 1;
        rowScale[c.row + 1] = scale;
        break;
      case "rotary-driver":
        rowScale[c.row] = 1;
        break;
      case "linear-driver":
        rowScale[c.row] = scale;
        break;
    }
  }

  const size = n + m;
  return {
    kin,
    metersPerUnit: scale,
    gravity: { x: doc.dynamics.gravity[0], y: doc.dynamics.gravity[1] },
    bodies,
    loads,
    linearSprings,
    torsionalSprings,
    actuators,
    driverCoordinates,
    colScale,
    rowScale,
    issues,
    workspace: {
      M: new Float64Array(n * n),
      Q: new Float64Array(n),
      J: new Float64Array(m * n),
      rhs: new Float64Array(m),
      K: new Float64Array(size * size),
      x: new Float64Array(size),
      piv: new Int32Array(size),
      K2: new Float64Array(size * size),
      grad: new Float64Array(n),
      vSI: new Float64Array(n),
    },
  };
}
