/**
 * Pure CAD-style dynamic length/angle input: a keystroke buffer
 * (`DynamicInputState`) plus `resolveDynamicInput`, which turns the typed
 * text (relative to a drawing anchor and the live cursor) into an exact
 * `{length, angle}` pair. Typed angles are degrees CCW from +x; the document
 * stores radians, so `resolveDynamicInput` converts via `degToRad`.
 */

import { direction, distance, magnitude, sub, type Vec2 } from "../geom";
import { degToRad } from "../model/units";
import { parseNumberInput } from "../i18n/numberFormat";

export interface DynamicInputState {
  field: "length" | "angle";
  length: string;
  angle: string;
}

export type DynamicInputAction = "edit" | "commit" | "cancel" | "unhandled";

export interface DynamicInputKeyResult {
  state: DynamicInputState;
  action: DynamicInputAction;
}

export type DynamicInputResolution =
  { length: number; angle: number } | { error: "invalid-length" };

const DIGIT_RE = /^[0-9]$/;
const SEPARATOR_RE = /[.,]/;

/** An empty buffer, length field active (the field CAD tools start on). */
export function initialDynamicInput(): DynamicInputState {
  return { field: "length", length: "", angle: "" };
}

/**
 * Applies one keystroke to `s`. Digits append to the active field; `Tab`
 * switches fields; `Backspace` deletes one character of the active field;
 * `.`/`,` insert the field's single decimal separator (a second one is
 * ignored); `Enter`/`Escape` report `"commit"`/`"cancel"` without touching
 * `s` (the caller resolves/discards it); anything else is `"unhandled"`.
 */
export function applyDynamicKey(s: DynamicInputState, key: string): DynamicInputKeyResult {
  if (key === "Enter") return { state: s, action: "commit" };
  if (key === "Escape") return { state: s, action: "cancel" };

  if (key === "Tab") {
    return { state: { ...s, field: s.field === "length" ? "angle" : "length" }, action: "edit" };
  }

  if (key === "Backspace") {
    return { state: { ...s, [s.field]: s[s.field].slice(0, -1) }, action: "edit" };
  }

  if (DIGIT_RE.test(key)) {
    return { state: { ...s, [s.field]: s[s.field] + key }, action: "edit" };
  }

  if (key === "." || key === ",") {
    const current = s[s.field];
    if (SEPARATOR_RE.test(current)) return { state: s, action: "edit" }; // second separator ignored
    return { state: { ...s, [s.field]: current + key }, action: "edit" };
  }

  return { state: s, action: "unhandled" };
}

/**
 * Resolves the typed buffer against `start`/`cursor`: a field left blank
 * falls back to the corresponding value implied by the live cursor
 * position. Returns `{error: "invalid-length"}` for an unparsable or
 * non-positive typed length (angle text is unparsable is treated the same
 * way, since neither can produce a usable commit).
 */
export function resolveDynamicInput(
  s: DynamicInputState,
  start: Vec2,
  cursor: Vec2,
): DynamicInputResolution {
  const rel = sub(cursor, start);

  let length: number;
  if (s.length !== "") {
    const parsed = parseNumberInput(s.length);
    if (parsed === null || parsed <= 0) return { error: "invalid-length" };
    length = parsed;
  } else {
    length = distance(start, cursor);
  }

  let angle: number;
  if (s.angle !== "") {
    const parsedDeg = parseNumberInput(s.angle);
    if (parsedDeg === null) return { error: "invalid-length" };
    angle = degToRad(parsedDeg);
  } else {
    angle = magnitude(rel) === 0 ? 0 : direction(rel);
  }

  return { length, angle };
}
