/**
 * The imperative half of the Phase 5 posed-rendering seam: given a
 * `RenderModel` (already built with a `PosesSource`'s current poses) and the
 * current `Viewport`, repositions the EXISTING Konva nodes `LinksLayer`/
 * `JointsLayer` created on the last React render -- no React re-render, no
 * new Konva nodes.
 *
 * Node lookup is by the stable `id` attributes those layers stamp onto every
 * bar/plate group, pin/motor/marker/free-site/ground-pivot shape and slider
 * group (`link:<id>`, `pin:<id>`, `slider:<id>`, `motor:<id>`, `marker:<id>`,
 * `site:<id>`, `ground:<id>`). Lookup walks `layer.find` with a predicate
 * function rather than a `#id` CSS-style selector string, since document ids
 * are opaque and not guaranteed selector-safe.
 *
 * A node id present in the render model but missing from the layer (or vice
 * versa) is skipped silently -- the node structure only changes on a real
 * React render, which always runs `applyRenderModelToLayers` again
 * immediately after via the same effect.
 */

import Konva from "konva";
import type { Vec2 } from "../../geom";
import type { RenderModel } from "../renderModel";
import { angleToKonvaRotationDeg, worldToScreen, type Viewport } from "../viewport";

export interface RenderLayers {
  links: Konva.Layer | null;
  joints: Konva.Layer | null;
}

function toScreenFlat(viewport: Viewport, points: readonly Vec2[]): number[] {
  const flat: number[] = [];
  for (const p of points) {
    const s = worldToScreen(viewport, p);
    flat.push(s.x, s.y);
  }
  return flat;
}

function indexById(layer: Konva.Layer | null): Map<string, Konva.Node> {
  const map = new Map<string, Konva.Node>();
  if (!layer) return map;
  const nodes = layer.find((n: Konva.Node) => n.id() !== "");
  for (const node of nodes) map.set(node.id(), node);
  return map;
}

function setPoints(group: Konva.Node | undefined, flat: number[]): void {
  if (!(group instanceof Konva.Group)) return;
  for (const child of group.getChildren()) {
    if (child instanceof Konva.Line) child.points(flat);
  }
}

function setPosition(node: Konva.Node | undefined, world: Vec2, viewport: Viewport): void {
  if (!node) return;
  const s = worldToScreen(viewport, world);
  node.x(s.x);
  node.y(s.y);
}

/**
 * Imperatively moves every node in `layers` to match `model`, projected
 * through `viewport`. Call after `posesSource.subscribe` fires, or whenever
 * the current poses need to be (re-)applied without waiting for React.
 */
export function applyRenderModelToLayers(
  layers: RenderLayers,
  model: RenderModel,
  viewport: Viewport,
): void {
  const linkNodes = indexById(layers.links);
  const jointNodes = indexById(layers.joints);

  for (const bar of model.bars) {
    setPoints(linkNodes.get(`link:${bar.linkId}`), toScreenFlat(viewport, bar.points));
  }
  for (const plate of model.plates) {
    setPoints(linkNodes.get(`link:${plate.linkId}`), toScreenFlat(viewport, plate.points));
  }

  for (const pivot of model.groundPivots) {
    setPosition(jointNodes.get(`ground:${pivot.siteId}`), pivot.point, viewport);
  }
  for (const pin of model.pins) {
    setPosition(jointNodes.get(`pin:${pin.jointId}`), pin.point, viewport);
  }
  for (const slider of model.sliders) {
    const node = jointNodes.get(`slider:${slider.jointId}`);
    setPosition(node, slider.point, viewport);
    if (node) node.rotation(angleToKonvaRotationDeg(slider.blockAngle));
  }
  for (const motor of model.motors) {
    setPosition(jointNodes.get(`motor:${motor.jointId}`), motor.point, viewport);
  }
  for (const marker of model.markers) {
    setPosition(jointNodes.get(`marker:${marker.markerId}`), marker.point, viewport);
  }
  for (const site of model.freeSites) {
    setPosition(jointNodes.get(`site:${site.siteId}`), site.point, viewport);
  }

  layers.links?.batchDraw();
  layers.joints?.batchDraw();
}
