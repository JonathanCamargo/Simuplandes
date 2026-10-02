/**
 * Import report + option contracts (09-01). Report items are DATA (code +
 * params + ids + fixes), never localized text, following `ExportReport`.
 * A fix is a partial `ImportOptions`; applying one means re-running
 * `planImport` with the merged options. Pure types and constants only:
 * `src/interchange` stays free of React, kinematics and sim imports.
 */

import type { MechanismDocument } from "../model";

export type Vec2Tuple = readonly [number, number];

export type ImportSeverity = "error" | "warning" | "info";

export type ImportCode =
  // fatal errors
  | "unparseable"
  | "unknown-format"
  | "too-large"
  | "empty-graph"
  // warnings
  | "no-ground"
  | "self-loop"
  | "duplicate-edge"
  | "disconnected"
  | "partial-positions"
  | "missing-input"
  | "several-inputs"
  | "input-not-on-ground"
  | "unsupported-joint"
  | "prismatic-no-axis"
  // info
  | "multi-joint"
  | "units-unknown"
  | "layout-applied"
  // layout-mode outcomes
  | "layout-unavailable"
  | "lengths-infeasible"
  | "not-one-dof-topology"
  // verdict warnings
  | "dof-not-one"
  | "not-drivable"
  | "assembly-failed"
  | "low-mobility";

export interface ImportFix {
  readonly id: string;
  readonly option: Partial<ImportOptions>;
  readonly params?: Record<string, string | number>;
}

export interface ImportReportItem {
  readonly key: string;
  readonly severity: ImportSeverity;
  readonly code: ImportCode;
  readonly fatal: boolean;
  readonly params: Record<string, string | number | readonly (string | number)[]>;
  /** Normalized node ids. */
  readonly nodeIds: readonly number[];
  /** `"u-v"` with u < v (normalized ids). */
  readonly edgeKeys: readonly string[];
  /** At least one for every warning. */
  readonly fixes: readonly ImportFix[];
  /** The resolution currently applied, if any. */
  readonly activeFixId: string | null;
}

export interface ImportOptions {
  /** `auto`: node 0, else the lowest normalized id. */
  ground: "auto" | number;
  input: "auto" | "none" | { readonly u: number; readonly v: number };
  unsupportedJoints: "revolute" | "skip";
  /** The default axis is (1, 0). */
  prismaticWithoutAxis: "default-axis" | "revolute";
  /** `drop` keeps only the ground's component. */
  disconnected: "drop" | "keep";
  /** `auto`: the given positions when all are present, else layout. */
  positions: "auto" | "layout" | "centroid";
  /** 0 = default; "try another layout" increments. */
  layoutVariant: number;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  ground: "auto",
  input: "auto",
  unsupportedJoints: "revolute",
  prismaticWithoutAxis: "default-axis",
  disconnected: "drop",
  positions: "auto",
  layoutVariant: 0,
};

/** A drawing "moves" when its reachable input range is at least this many degrees (assumption A5). */
export const MOBILITY_TARGET_DEG = 60;

export interface LayoutEdge {
  readonly u: number;
  readonly v: number;
  readonly kind: "R" | "P";
  readonly axis: Vec2Tuple | null;
}

export interface LayoutRequest {
  readonly nodeCount: number;
  readonly edges: readonly LayoutEdge[];
  readonly inputEdge: number | null;
  readonly lengths: readonly (number | null)[] | null;
  readonly variant: number;
}

export interface LayoutResult {
  readonly status: "ok" | "low-mobility" | "lengths-infeasible" | "not-one-dof" | "cancelled";
  readonly positions: readonly Vec2Tuple[] | null;
  readonly rangeDeg: number;
  readonly tries: number;
  readonly lengthResidual: number | null;
}

export interface LayoutControl {
  readonly signal?: AbortSignal;
  readonly onProgress?: (tries: number, maxTries: number) => void;
}

/**
 * rangeDeg is always finite: rotary -> reachable input range in degrees
 * (360 for a full rotation); linear or no input -> 0. linearTravel: linear
 * input -> inputMax - inputMin in model units; otherwise null.
 */
export interface MobilityVerdict {
  readonly status: "ready" | "not-drivable" | "assembly-failed" | "invalid" | "empty";
  readonly gruebler: number | null;
  readonly rankDof: number | null;
  readonly inputKind: "rotary" | "linear" | null;
  readonly rangeDeg: number;
  readonly linearTravel: number | null;
  readonly fullRotation: boolean;
}

export interface ImportDeps {
  readonly layout?: (req: LayoutRequest, ctl?: LayoutControl) => Promise<LayoutResult>;
  readonly verify?: (doc: MechanismDocument) => MobilityVerdict;
}

const FATAL_CODES: ReadonlySet<ImportCode> = new Set<ImportCode>([
  "unparseable",
  "unknown-format",
  "too-large",
  "empty-graph",
]);

export interface ItemExtras {
  readonly nodeIds?: readonly number[];
  readonly edgeKeys?: readonly string[];
  readonly params?: ImportReportItem["params"];
  readonly fixes?: readonly ImportFix[];
  readonly activeFixId?: string | null;
}

/** Canonical edge key: `"u-v"` with u < v. */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Builds an item with a stable `key` (code + node ids + edge keys) and `fatal` set for the four fatal codes. */
export function makeItem(
  code: ImportCode,
  severity: ImportSeverity,
  extras: ItemExtras = {},
): ImportReportItem {
  const nodeIds = extras.nodeIds ?? [];
  const edgeKeys = extras.edgeKeys ?? [];
  return {
    key: [code, nodeIds.join(","), edgeKeys.join(",")].join("|"),
    severity,
    code,
    fatal: FATAL_CODES.has(code),
    params: extras.params ?? {},
    nodeIds,
    edgeKeys,
    fixes: extras.fixes ?? [],
    activeFixId: extras.activeFixId ?? null,
  };
}
