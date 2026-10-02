/**
 * Session lifecycle: restore a document from `localStorage` on boot, create
 * the store from it, debounce-autosave every edit back to storage (flushed
 * on `pagehide`), and never crash on an unreadable saved session — back it
 * up instead and start empty.
 */

import { DocumentLoadError, parseDocumentJson, type MechanismDocument } from "../model";
import { createMechanismStore, type MechanismStore, type MechanismStoreOptions } from "../store";

export const SESSION_STORAGE_KEY = "simuplandes:session";
export const UNREADABLE_SESSION_KEY = "simuplandes:session:unreadable";

export type SessionLoadResult =
  | { status: "empty" }
  | { status: "restored"; document: MechanismDocument }
  | { status: "error"; error: DocumentLoadError };

/** `window.localStorage` if it exists and actually works (private-mode/quota-denied browsers return `null`). */
export function getLocalStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const probeKey = "simuplandes:probe";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Reads and parses the saved session via `parseDocumentJson` (never a raw
 * parse-and-cast). On a `DocumentLoadError` it copies the raw text to
 * `UNREADABLE_SESSION_KEY` (leaving the original key untouched) and returns
 * the error. Never throws.
 */
export function loadSession(storage: Storage): SessionLoadResult {
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (raw === null) return { status: "empty" };
  try {
    const document = parseDocumentJson(raw);
    return { status: "restored", document };
  } catch (e) {
    const error =
      e instanceof DocumentLoadError
        ? e
        : new DocumentLoadError("invalid", [], "could not restore the saved session");
    try {
      storage.setItem(UNREADABLE_SESSION_KEY, raw);
    } catch {
      // Best-effort backup only; storage itself may be the thing failing (e.g. quota).
    }
    return { status: "error", error };
  }
}

/** Writes `doc` to the session key as compact JSON. */
export function saveSession(storage: Storage, doc: MechanismDocument): void {
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(doc));
}

export interface AutosaveHandle {
  /** Writes immediately, bypassing the debounce timer. */
  flush(): void;
  /** Unsubscribes from the store; later edits are not written. Does not flush. */
  stop(): void;
}

/**
 * Subscribes to `store` and writes its document to `storage` after edits
 * settle (default 500 ms debounce). Selection-only changes never write,
 * since only `state.document` identity is compared. A `storage.setItem`
 * failure (e.g. `QuotaExceededError`) routes to `onError` and never throws.
 */
export function startAutosave(
  store: MechanismStore,
  storage: Storage,
  options?: { debounceMs?: number; onError?: (e: unknown) => void },
): AutosaveHandle {
  const debounceMs = options?.debounceMs ?? 500;
  const onError = options?.onError;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function writeNow(): void {
    timer = null;
    try {
      saveSession(storage, store.getState().document);
    } catch (e) {
      onError?.(e);
    }
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(writeNow, debounceMs);
  }

  const unsubscribe = store.subscribe((state, prevState) => {
    if (state.document !== prevState.document) schedule();
  });

  function flush(): void {
    if (timer !== null) clearTimeout(timer);
    writeNow();
  }

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unsubscribe();
  }

  return { flush, stop };
}

export interface Session {
  store: MechanismStore;
  restore: SessionLoadResult;
  autosave: AutosaveHandle | null;
  /** Removes the "pagehide" listener, flushes, then stops autosave. */
  dispose(): void;
}

type WindowTarget = Pick<Window, "addEventListener" | "removeEventListener">;

function defaultTarget(): WindowTarget | null {
  return typeof window === "undefined" ? null : window;
}

/**
 * Starts a session: restores from `storage` (default `getLocalStorage()`),
 * creates the store from the restored document (or empty), and — when
 * storage exists — wires debounced autosave plus a `pagehide` flush on
 * `target` (default the global `window`, when present).
 */
export function startSession(options?: {
  storage?: Storage | null;
  target?: WindowTarget | null;
  debounceMs?: number;
  onAutosaveError?: (e: unknown) => void;
  storeOptions?: Omit<MechanismStoreOptions, "initialDocument">;
}): Session {
  const storage = options?.storage !== undefined ? options.storage : getLocalStorage();
  const target = options?.target !== undefined ? options.target : defaultTarget();

  const restore: SessionLoadResult = storage ? loadSession(storage) : { status: "empty" };
  const initialDocument = restore.status === "restored" ? restore.document : undefined;

  const store = createMechanismStore({
    ...options?.storeOptions,
    ...(initialDocument !== undefined ? { initialDocument } : {}),
  });

  const autosave = storage
    ? startAutosave(store, storage, {
        debounceMs: options?.debounceMs,
        ...(options?.onAutosaveError !== undefined ? { onError: options.onAutosaveError } : {}),
      })
    : null;

  function handlePagehide(): void {
    autosave?.flush();
  }

  target?.addEventListener("pagehide", handlePagehide);

  function dispose(): void {
    target?.removeEventListener("pagehide", handlePagehide);
    autosave?.flush();
    autosave?.stop();
  }

  return { store, restore, autosave, dispose };
}
