/**
 * The background reference image (`doc.background`), painted first so the
 * grid and the mechanism draw over it. Like every layer it is
 * `listening={false}`: the Image tool moves and scales it through the
 * Stage's own pointer events.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Image as KonvaImage, Layer } from "react-konva";
import type { BackgroundImage } from "../../model";
import { worldLengthToScreen, worldToScreen, type Viewport } from "../viewport";

export interface BackgroundLayerProps {
  viewport: Viewport;
  background: BackgroundImage | undefined;
}

/** The decoded image for `src`, or `null` until it has loaded (or when it fails to). */
function useDecodedImage(src: string | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!src) return undefined;
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled) setLoaded({ src, image });
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return loaded && loaded.src === src ? loaded.image : null;
}

export function BackgroundLayer({ viewport, background }: BackgroundLayerProps): ReactNode {
  const image = useDecodedImage(background?.src);
  if (!background || !image) return null;

  const [cx, cy] = background.center;
  // The top-left corner on screen (world y-up: the top edge is centre + height/2).
  const topLeft = worldToScreen(viewport, {
    x: cx - background.width / 2,
    y: cy + background.height / 2,
  });
  return (
    <Layer listening={false}>
      <KonvaImage
        image={image}
        x={topLeft.x}
        y={topLeft.y}
        width={worldLengthToScreen(viewport, background.width)}
        height={worldLengthToScreen(viewport, background.height)}
        opacity={background.opacity}
        listening={false}
      />
    </Layer>
  );
}
