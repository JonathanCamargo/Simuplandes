/**
 * How close (in screen px) a pointer must be to pick or snap to something.
 * A fingertip covers far more than a mouse cursor, so touch gets a wider
 * radius; mouse and pen keep the original 8px.
 */

export const PICK_RADIUS_PX = 8;
export const TOUCH_PICK_RADIUS_PX = 18;

/** `pointerType` as in `PointerEvent.pointerType`; anything but "touch" (or nothing) is precise. */
export function pickRadiusPx(pointerType?: string): number {
  return pointerType === "touch" ? TOUCH_PICK_RADIUS_PX : PICK_RADIUS_PX;
}
