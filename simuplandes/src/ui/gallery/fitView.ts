/**
 * `fitViewToDocument`: the `DrawingSvgView` (viewport + box size) that frames
 * every site, plate vertex and marker of `doc` inside a `width` x `height`
 * thumbnail with `padding` px around it. An empty document gets the default
 * viewport (same rule as the canvas's own fit).
 */

import { documentBounds } from "../../canvas/bounds";
import { fitToBounds } from "../../canvas/viewport";
import type { MechanismDocument } from "../../model";
import type { DrawingSvgView } from "../export/DrawingSvg";

export function fitViewToDocument(
  doc: MechanismDocument,
  width: number,
  height: number,
  padding: number,
): DrawingSvgView {
  const base = { panWorld: { x: 0, y: 0 }, zoom: 1, widthPx: width, heightPx: height };
  return {
    viewport: fitToBounds(base, documentBounds(doc), padding),
    widthPx: width,
    heightPx: height,
  };
}
