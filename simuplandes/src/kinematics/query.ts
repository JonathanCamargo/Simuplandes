/**
 * Per-link and per-marker world kinematics from a solved `(q, qDot, qDDot)`
 * triple. Runs once per marker/link per frame (never inside the Newton
 * loop), so it is written for clarity over the constraint modules' inlined
 * scalar math, using `src/geom`'s `rotate`/`perp` directly.
 */

import { rotate, perp, type Vec2 } from "../geom";
import { linkPose, type KinematicSystem } from "./system";

/** World position/velocity/acceleration of a single point (a site or marker). */
export interface PointKinematics {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly acceleration: Vec2;
}

/** A link's world pose and its first/second time derivatives. */
export interface LinkKinematics {
  readonly id: string;
  readonly pose: { readonly x: number; readonly y: number; readonly angle: number };
  readonly velocity: { readonly x: number; readonly y: number; readonly omega: number };
  readonly acceleration: { readonly x: number; readonly y: number; readonly alpha: number };
}

/** Every link's and every marker's kinematics for one solved frame. */
export interface FrameKinematics {
  readonly links: ReadonlyMap<string, LinkKinematics>;
  readonly markers: ReadonlyMap<string, PointKinematics>;
}

interface LinkRates {
  readonly x: number;
  readonly y: number;
  readonly omega: number;
}

interface LinkAccels {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
}

/** A link's `(xDot, yDot, omega)`; zero for ground links. */
function linkRates(system: KinematicSystem, qDot: Float64Array, linkIndex: number): LinkRates {
  const slot = system.links[linkIndex];
  if (slot.offset < 0) return { x: 0, y: 0, omega: 0 };
  return { x: qDot[slot.offset], y: qDot[slot.offset + 1], omega: qDot[slot.offset + 2] };
}

/** A link's `(xDDot, yDDot, alpha)`; zero for ground links. */
function linkAccels(system: KinematicSystem, qDDot: Float64Array, linkIndex: number): LinkAccels {
  const slot = system.links[linkIndex];
  if (slot.offset < 0) return { x: 0, y: 0, alpha: 0 };
  return { x: qDDot[slot.offset], y: qDDot[slot.offset + 1], alpha: qDDot[slot.offset + 2] };
}

/**
 * World position/velocity/acceleration of a link-local point `local` on
 * link `linkIndex`. `off = R(theta)*local`; `velocity = rDot + omega*perp(off)`;
 * `acceleration = rDDot + alpha*perp(off) - omega^2*off`.
 */
export function pointKinematics(
  system: KinematicSystem,
  q: Float64Array,
  qDot: Float64Array,
  qDDot: Float64Array,
  linkIndex: number,
  local: Vec2,
): PointKinematics {
  const pose = linkPose(system, q, linkIndex);
  const rates = linkRates(system, qDot, linkIndex);
  const accels = linkAccels(system, qDDot, linkIndex);

  const off = rotate(local, pose.angle);
  const perpOff = perp(off);
  const omegaSq = rates.omega * rates.omega;

  return {
    position: { x: pose.x + off.x, y: pose.y + off.y },
    velocity: {
      x: rates.x + perpOff.x * rates.omega,
      y: rates.y + perpOff.y * rates.omega,
    },
    acceleration: {
      x: accels.x + perpOff.x * accels.alpha - off.x * omegaSq,
      y: accels.y + perpOff.y * accels.alpha - off.y * omegaSq,
    },
  };
}

/** Every link's (pose, velocity, acceleration) and every marker's world `PointKinematics`, for one solved frame. */
export function computeFrameKinematics(
  system: KinematicSystem,
  q: Float64Array,
  qDot: Float64Array,
  qDDot: Float64Array,
): FrameKinematics {
  const links = new Map<string, LinkKinematics>();
  system.links.forEach((slot, linkIndex) => {
    const pose = linkPose(system, q, linkIndex);
    const rates = linkRates(system, qDot, linkIndex);
    const accels = linkAccels(system, qDDot, linkIndex);
    links.set(slot.id, { id: slot.id, pose, velocity: rates, acceleration: accels });
  });

  const markers = new Map<string, PointKinematics>();
  for (const marker of system.markers) {
    markers.set(
      marker.id,
      pointKinematics(system, q, qDot, qDDot, marker.linkIndex, {
        x: marker.local.x,
        y: marker.local.y,
      }),
    );
  }

  return { links, markers };
}
