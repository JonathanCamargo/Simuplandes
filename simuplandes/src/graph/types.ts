/**
 * The single link-graph contract for Phase 6: every `MechanismDocument`
 * merges its ground links into one `GROUND_NODE_ID` node (one node per
 * moving link otherwise), one edge per joint (R or P). `fromDocument.ts`
 * builds this from a document; `mobility.ts`/`linkAssortment.ts`/
 * `baranov.ts` (topology-only checks) and the graph panel/atlas
 * identification (06-02..06-06) all read this one shape -- no other module
 * defines a second merge convention.
 */

import type { Id } from "../model";
import type { Vec2 } from "../geom";
import type { LinkType } from "../ui/theme/tokens";

/** The id of the single node every `isGround` link merges into. */
export const GROUND_NODE_ID = "__ground__";

/** A merged-graph node: either the one ground node, or exactly one moving link. */
export interface GraphNode {
  /** `GROUND_NODE_ID` for the merged ground node, else the link id. */
  id: Id;
  /** Ground: every `isGround` link id, in document order. Else: `[link.id]`. */
  linkIds: readonly Id[];
  isGround: boolean;
  /** `"ground"` for the merged ground node; else `linkTypes(doc).get(link.id)` -- one classifier, never re-derived. */
  linkType: LinkType;
  /** Incident edges in this graph's `edges` (parallel edges between the same two nodes count separately). */
  degree: number;
  /** `link.name`, or `""` when empty (the UI localizes "ground" / supplies fallbacks). */
  label: string;
  /** Reference-pose WORLD centroid (see `fromDocument.ts`'s doc comment for the exact rule). */
  centroid: Vec2;
}

/** A merged-graph edge: one per document joint that resolves to two distinct nodes. */
export interface GraphEdge {
  /** = `jointId`. */
  id: Id;
  jointId: Id;
  type: "R" | "P";
  /** `GraphNode` ids (ground-merged). `a` is the node of `siteA`'s link. */
  a: Id;
  b: Id;
  /** `true` iff `a` or `b` is `GROUND_NODE_ID`. */
  groundPivot: boolean;
}

/** A joint that could not become an edge: still counted in `jointCount`. */
export type GraphWarning =
  | { kind: "groundLoop"; jointId: Id } // both sites on ground links -> no edge emitted
  | { kind: "danglingJoint"; jointId: Id }; // a site id not found -> no edge emitted

/** The merged link graph for one `MechanismDocument`. */
export interface LinkGraph {
  /** Ground node first (if any ground link), then moving links in document order. */
  nodes: readonly GraphNode[];
  /** Document joint order, excluding warned joints. */
  edges: readonly GraphEdge[];
  /** ALL document joints (including `groundLoop`/`danglingJoint`) -- matches kinematics' Gruebler joint count. */
  jointCount: number;
  warnings: readonly GraphWarning[];
  nodeById: ReadonlyMap<Id, GraphNode>;
  /** Link id -> `GraphNode` id (ground links all map to `GROUND_NODE_ID`). */
  nodeIdOfLink: ReadonlyMap<Id, Id>;
}
