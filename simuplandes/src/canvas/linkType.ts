/**
 * Classifies a link by how many distinct joints touch its sites, matching
 * GraphThe's link-type vocabulary. Pure data module (imports only the
 * `LinkType`/`LINK_TYPE_COLORS` data map from `../ui/theme/tokens`, which is
 * itself framework-free) -- allowed under the purity rule, which only bans
 * React/Konva/MUI imports, not other pure data.
 */

import {
  indexDocument,
  type DocumentIndex,
  type Id,
  type Link,
  type MechanismDocument,
} from "../model";
import { type LinkType } from "../ui/theme/tokens";

export type { LinkType } from "../ui/theme/tokens";

/**
 * The one degree -> `LinkType` classifier (binary/ternary/quaternary/
 * pentary), never `"ground"`. Shared by `linkTypeOf` (per-link, from a
 * document's joints) and `src/interchange/graphthe.ts`'s exporter (per
 * exported-node degree) so canvas coloring, the graph panel, and the
 * GraphThe export always agree — no third variant.
 */
export function linkTypeForJointCount(count: number): LinkType {
  switch (true) {
    case count <= 2:
      return "binary";
    case count === 3:
      return "ternary";
    case count === 4:
      return "quaternary";
    default:
      return "pentary";
  }
}

/** `ground` for a ground link; otherwise binary/ternary/quaternary/pentary by distinct-joint count. */
export function linkTypeOf(doc: MechanismDocument, link: Link, index?: DocumentIndex): LinkType {
  if (link.isGround) return "ground";

  const idx = index ?? indexDocument(doc);
  const jointIds = new Set<Id>();
  for (const site of link.sites) {
    const joints = idx.jointsBySite.get(site.id);
    if (joints) for (const joint of joints) jointIds.add(joint.id);
  }

  return linkTypeForJointCount(jointIds.size);
}

/** `linkTypeOf` for every link in `doc`, computing one shared `DocumentIndex`. */
export function linkTypes(doc: MechanismDocument): Map<Id, LinkType> {
  const index = indexDocument(doc);
  const map = new Map<Id, LinkType>();
  for (const link of doc.links) {
    map.set(link.id, linkTypeOf(doc, link, index));
  }
  return map;
}
