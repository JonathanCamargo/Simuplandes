/**
 * Mass properties of a link for dynamics: the authored `massProperties`, or
 * values computed from the link's shape as a uniform body. A bar is a chain
 * of slender rods through its sites (in site order) with the document's
 * linear density; a plate is a uniform lamina over its outline with the
 * areal density. Mass is in kg, inertia in kg·m² about the center of mass,
 * and the center of mass in link-local model units.
 */

import { flattenBar, flattenOutline } from "./shapeGeometry";
import { metersPerUnit } from "./units";
import type { Link, MassProperties, MechanismDocument } from "./schema";
import type { Vec2Tuple } from "./vec";

/** A link's effective mass properties, and whether they were authored or computed. */
export interface ResolvedMassProperties extends MassProperties {
  readonly source: "authored" | "computed";
}

function barMassProperties(link: Link, scale: number, density: number): MassProperties {
  // A curved bar is integrated over its flattened polyline.
  const points = flattenBar(link);
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const segmentMass = density * Math.hypot(bx - ax, by - ay) * scale;
    mass += segmentMass;
    mx += segmentMass * (ax + bx) * 0.5;
    my += segmentMass * (ay + by) * 0.5;
  }
  if (mass === 0) {
    return { mass: 0, com: points[0] ? [points[0][0], points[0][1]] : [0, 0], inertia: 0 };
  }
  const com: Vec2Tuple = [mx / mass, my / mass];

  let inertia = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const length = Math.hypot(bx - ax, by - ay) * scale;
    const segmentMass = density * length;
    const dx = ((ax + bx) * 0.5 - com[0]) * scale;
    const dy = ((ay + by) * 0.5 - com[1]) * scale;
    inertia += (segmentMass * length * length) / 12 + segmentMass * (dx * dx + dy * dy);
  }
  return { mass, com, inertia };
}

function plateMassProperties(
  outline: readonly Vec2Tuple[],
  scale: number,
  density: number,
): MassProperties {
  // Shoelace sums over the outline in meters. The signed area keeps the
  // centroid and second moment consistent for either winding.
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  let second = 0;
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    const x0 = ax * scale;
    const y0 = ay * scale;
    const x1 = bx * scale;
    const y1 = by * scale;
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
    second += cross * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1);
  }
  const area = area2 / 2;
  if (area === 0) {
    const [x, y] = outline[0];
    return { mass: 0, com: [x, y], inertia: 0 };
  }
  const comX = cx / (6 * area);
  const comY = cy / (6 * area);
  const mass = density * Math.abs(area);
  // `second / 12` is the signed polar moment about the origin per unit density.
  const inertiaOrigin = (density * second) / 12;
  const inertia = Math.abs(inertiaOrigin) - mass * (comX * comX + comY * comY);
  return { mass, com: [comX / scale, comY / scale], inertia: Math.max(inertia, 0) };
}

/** Mass properties computed from `link`'s shape with `doc`'s densities and length unit. */
export function computedMassProperties(
  link: Link,
  doc: Pick<MechanismDocument, "units" | "dynamics">,
): MassProperties {
  const scale = metersPerUnit(doc.units.length);
  if (link.shape.kind === "plate") {
    return plateMassProperties(
      flattenOutline(link.shape.outline, link.shape.edges),
      scale,
      doc.dynamics.plateDensity,
    );
  }
  return barMassProperties(link, scale, doc.dynamics.barDensity);
}

/** `link`'s authored mass properties when it has them, otherwise the computed ones. */
export function resolveMassProperties(
  link: Link,
  doc: Pick<MechanismDocument, "units" | "dynamics">,
): ResolvedMassProperties {
  if (link.massProperties) {
    const { mass, com, inertia } = link.massProperties;
    return { mass, com: [com[0], com[1]], inertia, source: "authored" };
  }
  return { ...computedMassProperties(link, doc), source: "computed" };
}
