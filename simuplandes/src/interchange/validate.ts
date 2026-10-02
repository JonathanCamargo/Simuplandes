/**
 * `buildExportReport` (XCH-02): the pre-export validation report the 08-05
 * export panel renders. Pure data -- items carry codes + params + the
 * offending linkIds/jointIds, NEVER localized text (the panel localizes).
 *
 * Built ONLY from `result.notes`, `result.envelope` and the document's
 * motors (kind, joint) -- never re-derives ground merging or edges. DOF
 * is Gruebler on the EXPORTED graph (`F = 3*(n-1) - 2*j`, the same
 * formula semantics as `src/graph/mobility.ts::graphMobility`, computed
 * inline from the exported node/edge counts since the report reads the
 * post-split envelope, not a `LinkGraph`).
 */

import type { Id, MechanismDocument } from "../model";
import type { GraphtheExportResult } from "./graphthe";

export type ReportSeverity = "error" | "warning" | "info";

export type ReportCode =
  | "cannot-simulate-dof" // error, params {dof}
  | "cannot-simulate-no-motor" // error
  | "cannot-simulate-several-motors" // error, params {count}
  | "cannot-simulate-motor-not-on-ground" // error
  | "cannot-simulate-linear-motor" // error
  | "no-ground" // error
  | "parallel-joint" // warning (second joint between the same two nodes not exported)
  | "dangling-joint" // warning
  | "unusual-link-degree" // warning: moving node with exported degree 1 or > 5 (dms atlas cannot classify it)
  | "multi-joint-split" // info, params {links, hub, kept, synthesized, dropped}
  | "merged-ground" // info, params {names}
  | "ground-loop"; // info (joint between two fixed bodies, not exported)

export interface ReportItem {
  /** Unique stable key (code + ids) for React lists. */
  readonly key: string;
  readonly severity: ReportSeverity;
  readonly code: ReportCode;
  readonly params: Record<string, string | number | readonly string[]>;
  readonly linkIds: readonly Id[];
  readonly jointIds: readonly Id[];
}

export interface ExportReport {
  readonly items: readonly ReportItem[];
  readonly counts: Record<ReportSeverity, number>;
}

const SEVERITY_ORDER: Record<ReportSeverity, number> = { error: 0, warning: 1, info: 2 };

interface RawItem extends Omit<ReportItem, "key"> {
  /** Document order of the underlying note/joint, for a stable sort within a severity. */
  readonly order: number;
}

function makeItem(
  order: number,
  severity: ReportSeverity,
  code: ReportCode,
  params: Record<string, string | number | readonly string[]>,
  linkIds: readonly Id[],
  jointIds: readonly Id[],
): RawItem {
  return { order, severity, code, params, linkIds, jointIds };
}

function itemKey(code: ReportCode, linkIds: readonly Id[], jointIds: readonly Id[]): string {
  const links = [...linkIds].sort().join(",");
  const joints = [...jointIds].sort().join(",");
  return `${code}|${links}|${joints}`;
}

/**
 * Builds the pre-export report for `doc` from an already-computed
 * `exportGraphthe(doc)` result. Items are ordered errors, warnings, info
 * (stable, document order within a severity); `counts` matches.
 */
export function buildExportReport(
  doc: MechanismDocument,
  result: GraphtheExportResult,
): ExportReport {
  const { envelope, notes } = result;
  const items: RawItem[] = [];
  let order = 0;

  // ---- info/warning notes from the exporter (document order) ----
  const splitGroupsByFirstJoint = new Map<Id, (typeof notes)[number]>();
  for (const note of notes) {
    if (note.code === "multi-joint-split") splitGroupsByFirstJoint.set(note.jointIds[0], note);
  }

  for (const note of notes) {
    switch (note.code) {
      case "no-ground":
        items.push(makeItem(order++, "error", "no-ground", {}, [], []));
        break;
      case "merged-ground":
        items.push(
          makeItem(
            order++,
            "info",
            "merged-ground",
            { names: note.linkIds.map((id) => id) },
            note.linkIds,
            [],
          ),
        );
        break;
      case "parallel-joint":
        items.push(makeItem(order++, "warning", "parallel-joint", {}, [], note.jointIds));
        break;
      case "dangling-joint":
        items.push(makeItem(order++, "warning", "dangling-joint", {}, [], note.jointIds));
        break;
      case "ground-loop":
        items.push(makeItem(order++, "info", "ground-loop", {}, note.linkIds, note.jointIds));
        break;
      case "multi-joint-split": {
        const plan = note.split!;
        const kept = plan.keptJointIds;
        const dropped = plan.droppedJointIds;
        const synthesized = plan.edges
          .filter((e) => e.jointId === null)
          .map((e) => `edge-${e.nodes[0]}-${e.nodes[1]}`);
        items.push(
          makeItem(
            order++,
            "info",
            "multi-joint-split",
            {
              links: plan.group.nodes.map((n) => String(n)),
              hub: plan.hubNode,
              kept: kept.map(String),
              synthesized,
              dropped: dropped.map(String),
            },
            note.linkIds,
            note.jointIds,
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  // ---- can't-simulate errors (GraphThe's limits; warn but allow) ----
  // DOF on the EXPORTED graph: F = 3*(n-1) - 2*j (Gruebler, the same
  // formula semantics as src/graph/mobility.ts::graphMobility).
  const n = envelope.graph.nodes.length;
  const j = envelope.graph.edges.length;
  const hasMovingNode = n > 1;
  if (hasMovingNode) {
    const dof = 3 * (n - 1) - 2 * j;
    if (dof !== 1) {
      items.push(makeItem(order++, "error", "cannot-simulate-dof", { dof }, [], []));
    }
  }

  const motorJointIds = doc.motors.map((m) => m.jointId);
  if (motorJointIds.length === 0) {
    items.push(makeItem(order++, "error", "cannot-simulate-no-motor", {}, [], []));
  }
  if (motorJointIds.length > 1) {
    items.push(
      makeItem(
        order++,
        "error",
        "cannot-simulate-several-motors",
        { count: motorJointIds.length },
        [],
        motorJointIds,
      ),
    );
  }

  // Motor placement/kind checks need each motor's joint and its edge.
  const index = new Map<Id, { siteA: Id; siteB: Id; type: "R" | "P" }>();
  for (const joint of doc.joints)
    index.set(joint.id, { siteA: joint.siteA, siteB: joint.siteB, type: joint.type });
  const siteLink = new Map<Id, Id>();
  for (const link of doc.links) for (const site of link.sites) siteLink.set(site.id, link.id);

  for (const motor of doc.motors) {
    const joint = index.get(motor.jointId);
    if (!joint) continue;
    if (motor.kind === "linear") {
      items.push(
        makeItem(order++, "error", "cannot-simulate-linear-motor", {}, [], [motor.jointId]),
      );
      continue;
    }
    // Rotary: the joint must touch ground (a ground edge) for GraphThe to drive it.
    const linkA = siteLink.get(joint.siteA);
    const linkB = siteLink.get(joint.siteB);
    const groundLinkIds = doc.links.filter((l) => l.isGround).map((l) => l.id);
    const touchesGround =
      (linkA !== undefined && groundLinkIds.includes(linkA)) ||
      (linkB !== undefined && groundLinkIds.includes(linkB));
    if (!touchesGround) {
      items.push(
        makeItem(
          order++,
          "error",
          "cannot-simulate-motor-not-on-ground",
          {},
          [linkA, linkB].filter((id): id is Id => id !== undefined),
          [motor.jointId],
        ),
      );
    }
  }

  // ---- unusual-link-degree warnings (post-split exported degree) ----
  const degreeByNode = new Map<number, number>();
  for (const edge of envelope.graph.edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
  }
  const linkOfNode = new Map<number, Id>();
  for (const [linkId, nodeId] of result.nodeOfLink) {
    if (nodeId === 0) continue;
    linkOfNode.set(nodeId, linkId);
  }
  for (const node of envelope.graph.nodes) {
    if (node.id === 0) continue;
    const degree = degreeByNode.get(node.id) ?? 0;
    if (degree === 1 || degree > 5) {
      const linkId = linkOfNode.get(node.id);
      items.push(
        makeItem(
          order++,
          "warning",
          "unusual-link-degree",
          { degree, node: node.id },
          linkId !== undefined ? [linkId] : [],
          [],
        ),
      );
    }
  }

  // ---- sort: errors, warnings, info; stable document order within a severity ----
  items.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.order - b.order,
  );

  const counts: Record<ReportSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const item of items) counts[item.severity] += 1;

  const reportItems: ReportItem[] = items.map((item) => {
    const { order: _ignored, ...rest } = item;
    void _ignored;
    return { ...rest, key: itemKey(rest.code, rest.linkIds, rest.jointIds) };
  });

  return { items: reportItems, counts };
}
