/**
 * The pure measurement layer for Simulate mode (SIM-05): which quantities
 * exist on a compiled `KinematicSystem` (`listQuantities`), how to measure
 * them from a solved `(q, qDot, qDDot)` triple into DISPLAY units
 * (`measureAll`), and how to turn either a sweep sample array or a
 * ring-buffered time history into a plottable `MeasurementTable`
 * (`buildSweepTable`/`TimeHistory`).
 *
 * This module is the only place degrees-per-radian conversion happens for
 * plotting -- every `MeasurementTable` this module produces is already in
 * display units (deg, deg/s, deg/s^2 for angular quantities; the document's
 * length unit is a LABEL only, per MDL-05, so linear quantities are never
 * rescaled here). `src/sim/csv.ts` (same plan) consumes these tables
 * directly; no UI/React/Konva import here (pure orchestration, ESLint-
 * enforced).
 *
 * `MeasuredSampleInput` is declared locally (not imported) so this module
 * compiles standalone against plan 05-02's not-yet-written `SweepSample` --
 * any object with `{ input, q, qDot, qDDot }` satisfies it structurally.
 */

import { linkPose, pointKinematics, type KinematicSystem } from "../kinematics";

const RAD_TO_DEG = 180 / Math.PI;

/** A moving link's derived-quantity token. */
export type QuantityToken = "angle" | "omega" | "alpha" | "x" | "y" | "vx" | "vy" | "ax" | "ay";

/** The display unit for a quantity. Length-based units are labels only (MDL-05, no runtime conversion). */
export type QuantityUnit = "deg" | "deg/s" | "deg/s^2" | "len" | "len/s" | "len/s^2";

/** One plottable quantity: a moving link's angle/omega/alpha, or a marker's x/y/vx/vy/ax/ay. */
export interface QuantityDef {
  readonly id: string;
  readonly entityKind: "link" | "marker";
  readonly entityId: string;
  readonly entityLabel: string;
  readonly token: QuantityToken;
  readonly unit: QuantityUnit;
  readonly linkIndex: number;
  readonly local?: { readonly x: number; readonly y: number };
}

/**
 * A structural stand-in for plan 05-02's `SweepSample`: any object shaped
 * like this (one solved sample of a sweep or time march) satisfies it,
 * without importing 05-02's module (phase_rules: this plan compiles alone).
 */
export interface MeasuredSampleInput {
  readonly input: number;
  readonly q: Float64Array;
  readonly qDot: Float64Array;
  readonly qDDot: Float64Array;
}

/** A plottable table: one x column plus one column per requested quantity, all rows the same length. */
export interface MeasurementTable {
  readonly xKind: "input" | "time";
  readonly xUnit: "deg" | "len" | "s";
  readonly x: Float64Array;
  readonly quantities: readonly QuantityDef[];
  readonly columns: readonly Float64Array[];
  readonly length: number;
}

/**
 * Every plottable quantity on `system`, in document order: each moving
 * link's angle/omega/alpha (link quantities first), then each marker's
 * x/y/vx/vy/ax/ay. Ground links are never plotted (they never move).
 * `id` is `link:<id>:<token>` or `marker:<id>:<token>`; `entityLabel` is the
 * link/marker's own name when non-empty, otherwise its id.
 */
export function listQuantities(system: KinematicSystem): QuantityDef[] {
  const defs: QuantityDef[] = [];

  system.links.forEach((slot, linkIndex) => {
    if (slot.isGround) return;
    const entityLabel = slot.name || slot.id;
    const base = { entityKind: "link", entityId: slot.id, entityLabel, linkIndex } as const;
    defs.push({ ...base, id: `link:${slot.id}:angle`, token: "angle", unit: "deg" });
    defs.push({ ...base, id: `link:${slot.id}:omega`, token: "omega", unit: "deg/s" });
    defs.push({ ...base, id: `link:${slot.id}:alpha`, token: "alpha", unit: "deg/s^2" });
  });

  for (const marker of system.markers) {
    const base = {
      entityKind: "marker",
      entityId: marker.id,
      entityLabel: marker.label,
      linkIndex: marker.linkIndex,
      local: marker.local,
    } as const;
    defs.push({ ...base, id: `marker:${marker.id}:x`, token: "x", unit: "len" });
    defs.push({ ...base, id: `marker:${marker.id}:y`, token: "y", unit: "len" });
    defs.push({ ...base, id: `marker:${marker.id}:vx`, token: "vx", unit: "len/s" });
    defs.push({ ...base, id: `marker:${marker.id}:vy`, token: "vy", unit: "len/s" });
    defs.push({ ...base, id: `marker:${marker.id}:ax`, token: "ax", unit: "len/s^2" });
    defs.push({ ...base, id: `marker:${marker.id}:ay`, token: "ay", unit: "len/s^2" });
  }

  return defs;
}

/**
 * Writes `quantities[i]`'s value (in display units) into `out[i]` for the
 * solved frame `(q, qDot, qDDot)`. `out.length` must equal `quantities.length`.
 * Caches each distinct link's `linkPose` once per call (angle/omega/alpha
 * quantities on the same link share it); marker quantities each call
 * `pointKinematics` once (not further deduplicated -- not a hot path
 * requiring more than this).
 */
export function measureAll(
  system: KinematicSystem,
  q: Float64Array,
  qDot: Float64Array,
  qDDot: Float64Array,
  quantities: readonly QuantityDef[],
  out: Float64Array,
): void {
  const poseCache = new Map<number, { x: number; y: number; angle: number }>();
  const getPose = (linkIndex: number): { x: number; y: number; angle: number } => {
    let pose = poseCache.get(linkIndex);
    if (!pose) {
      pose = linkPose(system, q, linkIndex);
      poseCache.set(linkIndex, pose);
    }
    return pose;
  };

  for (let i = 0; i < quantities.length; i++) {
    const quantity = quantities[i];
    if (quantity.entityKind === "link") {
      const slot = system.links[quantity.linkIndex];
      switch (quantity.token) {
        case "angle":
          out[i] = getPose(quantity.linkIndex).angle * RAD_TO_DEG;
          break;
        case "omega":
          out[i] = (slot.offset < 0 ? 0 : qDot[slot.offset + 2]) * RAD_TO_DEG;
          break;
        case "alpha":
          out[i] = (slot.offset < 0 ? 0 : qDDot[slot.offset + 2]) * RAD_TO_DEG;
          break;
        default:
          out[i] = NaN;
      }
      continue;
    }

    const local = quantity.local ?? { x: 0, y: 0 };
    const pk = pointKinematics(system, q, qDot, qDDot, quantity.linkIndex, local);
    switch (quantity.token) {
      case "x":
        out[i] = pk.position.x;
        break;
      case "y":
        out[i] = pk.position.y;
        break;
      case "vx":
        out[i] = pk.velocity.x;
        break;
      case "vy":
        out[i] = pk.velocity.y;
        break;
      case "ax":
        out[i] = pk.acceleration.x;
        break;
      case "ay":
        out[i] = pk.acceleration.y;
        break;
      default:
        out[i] = NaN;
    }
  }
}

/**
 * Unwraps a column of degree values in place so that consecutive entries
 * never differ by more than 180 degrees (adds/subtracts multiples of 360 to
 * each entry after the first, relative to its already-unwrapped
 * predecessor). A no-op for non-angle columns (harmless if called on one).
 */
export function unwrapDegrees(column: Float64Array): void {
  for (let i = 1; i < column.length; i++) {
    let diff = column[i] - column[i - 1];
    while (diff > 180) {
      column[i] -= 360;
      diff -= 360;
    }
    while (diff < -180) {
      column[i] += 360;
      diff += 360;
    }
  }
}

/** Options for `buildSweepTable`: whether the driving input is an angle or a length, and a display offset. */
export interface BuildSweepTableOptions {
  readonly inputKind: "rotary" | "linear";
  readonly inputDisplayOffset: number;
}

/**
 * Builds a `MeasurementTable` from a sweep sample array: `x[i]` is the
 * sample's input converted to display units (`(inputDisplayOffset +
 * input)*180/pi` degrees for `"rotary"`, plain `input` for `"linear"` --
 * length is a label only, so no offset/scale applies), NOT wrapped (so a
 * full-turn sweep's `x` increases monotonically); `columns[j]` is
 * `quantities[j]` measured (via `measureAll`) at every sample, with angle
 * columns unwrapped afterward (Pitfall: a raw `atan2`-derived angle jumps by
 * 360 degrees at the branch cut, which would otherwise saw-tooth the plot).
 */
export function buildSweepTable(
  system: KinematicSystem,
  quantities: readonly QuantityDef[],
  samples: readonly MeasuredSampleInput[],
  opts: BuildSweepTableOptions,
): MeasurementTable {
  const length = samples.length;
  const x = new Float64Array(length);
  const columns = quantities.map(() => new Float64Array(length));
  const row = new Float64Array(quantities.length);

  for (let i = 0; i < length; i++) {
    const sample = samples[i];
    x[i] =
      opts.inputKind === "rotary"
        ? (opts.inputDisplayOffset + sample.input) * RAD_TO_DEG
        : sample.input;
    measureAll(system, sample.q, sample.qDot, sample.qDDot, quantities, row);
    for (let j = 0; j < quantities.length; j++) columns[j][i] = row[j];
  }

  quantities.forEach((quantity, j) => {
    if (quantity.token === "angle") unwrapDegrees(columns[j]);
  });

  return {
    xKind: "input",
    xUnit: opts.inputKind === "rotary" ? "deg" : "len",
    x,
    quantities,
    columns,
    length,
  };
}

/**
 * A fixed-capacity ring buffer of `(t, row)` samples, backed by one
 * preallocated `Float64Array` so `push` never allocates per call (it runs
 * every playback frame). Oldest samples are silently dropped once `size`
 * reaches `capacity`.
 */
export class TimeHistory {
  private readonly quantityCount: number;
  private readonly capacity: number;
  private readonly stride: number;
  private readonly ring: Float64Array;
  private start = 0;
  private count = 0;

  constructor(quantityCount: number, capacity = 3600) {
    this.quantityCount = quantityCount;
    this.capacity = capacity;
    this.stride = 1 + quantityCount;
    this.ring = new Float64Array(capacity * this.stride);
  }

  /** The number of samples currently stored (never more than `capacity`). */
  get size(): number {
    return this.count;
  }

  /** Appends `(t, row)`, storing a copy of `row`. Drops the oldest sample once full. Throws on a mismatched `row.length` (a programming error). */
  push(t: number, row: Float64Array): void {
    if (row.length !== this.quantityCount) {
      throw new Error(
        `TimeHistory.push: expected row.length === ${this.quantityCount}, got ${row.length}`,
      );
    }
    const writeIndex = (this.start + this.count) % this.capacity;
    const base = writeIndex * this.stride;
    this.ring[base] = t;
    for (let j = 0; j < this.quantityCount; j++) this.ring[base + 1 + j] = row[j];

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Empties the history (does not shrink the preallocated ring). */
  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  /** The stored samples as a chronological `MeasurementTable` (`xKind "time"`, `xUnit "s"`), angle columns unwrapped. */
  toTable(quantities: readonly QuantityDef[]): MeasurementTable {
    const length = this.count;
    const x = new Float64Array(length);
    const columns = quantities.map(() => new Float64Array(length));

    for (let i = 0; i < length; i++) {
      const idx = (this.start + i) % this.capacity;
      const base = idx * this.stride;
      x[i] = this.ring[base];
      for (let j = 0; j < quantities.length; j++) columns[j][i] = this.ring[base + 1 + j];
    }

    quantities.forEach((quantity, j) => {
      if (quantity.token === "angle") unwrapDegrees(columns[j]);
    });

    return { xKind: "time", xUnit: "s", x, quantities, columns, length };
  }
}

/**
 * The default plot quantity for `system`: the "output" link's angle. The
 * output link is the first moving link (document order) with a revolute or
 * prismatic joint straight to a ground link that is NOT one of
 * `inputLinkIndices` (the input joint's own two links) -- for a standard
 * four-bar, that is the rocker (the crank itself is excluded because it IS
 * an input link). Falls back to the first moving link that isn't an input
 * link, then to the first moving link, then to an empty array if there is
 * none.
 */
export function defaultQuantityIds(
  system: KinematicSystem,
  inputLinkIndices: readonly number[],
): string[] {
  const inputSet = new Set(inputLinkIndices);

  const hasGroundJoint = (linkIndex: number): boolean => {
    for (const c of system.constraints) {
      if (c.kind !== "revolute" && c.kind !== "prismatic") continue;
      if (c.a.linkIndex === linkIndex && system.links[c.b.linkIndex].isGround) return true;
      if (c.b.linkIndex === linkIndex && system.links[c.a.linkIndex].isGround) return true;
    }
    return false;
  };

  const movingLinks: number[] = [];
  system.links.forEach((slot, i) => {
    if (!slot.isGround) movingLinks.push(i);
  });

  const outputLinkIndex =
    movingLinks.find((i) => hasGroundJoint(i) && !inputSet.has(i)) ??
    movingLinks.find((i) => !inputSet.has(i)) ??
    movingLinks[0];

  if (outputLinkIndex === undefined) return [];
  return [`link:${system.links[outputLinkIndex].id}:angle`];
}
