import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMemoryStorage } from "./memoryStorage";
import {
  loadSession,
  saveSession,
  startAutosave,
  startSession,
  SESSION_STORAGE_KEY,
  UNREADABLE_SESSION_KEY,
} from "./session";
import { buildExampleFourBar, createMechanismStore, type MechanismStore } from "../store";
import { DocumentLoadError } from "../model";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";

describe("loadSession", () => {
  it("returns empty for an empty storage", () => {
    const storage = createMemoryStorage();
    expect(loadSession(storage)).toEqual({ status: "empty" });
  });

  it("round-trips via saveSession", () => {
    const storage = createMemoryStorage();
    saveSession(storage, fourBarFixtureParsed);
    expect(loadSession(storage)).toEqual({ status: "restored", document: fourBarFixtureParsed });
  });

  it("backs up malformed JSON and leaves the original key untouched", () => {
    const storage = createMemoryStorage({ [SESSION_STORAGE_KEY]: "{oops" });
    const result = loadSession(storage);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toBeInstanceOf(DocumentLoadError);
    }
    expect(storage.getItem(UNREADABLE_SESSION_KEY)).toBe("{oops");
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe("{oops");
  });

  it("backs up an unsupported (v99) document and leaves the original key untouched", () => {
    const raw = JSON.stringify({ ...fourBarFixtureParsed, schemaVersion: 99 });
    const storage = createMemoryStorage({ [SESSION_STORAGE_KEY]: raw });
    const result = loadSession(storage);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toBeInstanceOf(DocumentLoadError);
      expect(result.error.reason).toBe("newer-version");
    }
    expect(storage.getItem(UNREADABLE_SESSION_KEY)).toBe(raw);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(raw);
  });
});

describe("startAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces three executes within 500ms into exactly one write", () => {
    const storage = createMemoryStorage();
    const store = createTestStore();
    const autosave = startAutosave(store, storage, { debounceMs: 500 });

    const setItemSpy = vi.spyOn(storage, "setItem");
    buildExampleFourBar(store); // several execute() calls
    expect(setItemSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    autosave.stop();
  });

  it("does not write for selection-only changes", () => {
    const storage = createMemoryStorage();
    const store = createTestStore();
    buildExampleFourBar(store);
    const autosave = startAutosave(store, storage, { debounceMs: 500 });
    const setItemSpy = vi.spyOn(storage, "setItem");

    const [firstLink] = store.getState().document.links;
    if (!firstLink) throw new Error("expected at least one link");
    store.getState().select([firstLink.id]);
    vi.advanceTimersByTime(500);
    expect(setItemSpy).not.toHaveBeenCalled();

    autosave.stop();
  });

  it("flush() writes immediately", () => {
    const storage = createMemoryStorage();
    const store = createTestStore();
    const autosave = startAutosave(store, storage, { debounceMs: 500 });
    const setItemSpy = vi.spyOn(storage, "setItem");

    buildExampleFourBar(store);
    expect(setItemSpy).not.toHaveBeenCalled();
    autosave.flush();
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    autosave.stop();
  });

  it("stop() unsubscribes; later edits are not written", () => {
    const storage = createMemoryStorage();
    const store = createTestStore();
    const autosave = startAutosave(store, storage, { debounceMs: 500 });
    autosave.stop();

    const setItemSpy = vi.spyOn(storage, "setItem");
    buildExampleFourBar(store);
    vi.advanceTimersByTime(1000);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("routes a setItem failure to onError without throwing, and the store keeps working", () => {
    const storage = createMemoryStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const store = createTestStore();
    const onError = vi.fn();
    const autosave = startAutosave(store, storage, { debounceMs: 500, onError });

    expect(() => {
      buildExampleFourBar(store);
      vi.advanceTimersByTime(500);
    }).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.getState().document.links.length).toBeGreaterThan(0);

    autosave.stop();
  });
});

describe("startSession", () => {
  it("persists and restores a session across two startSession calls from the same storage", () => {
    const storage = createMemoryStorage();

    const first = startSession({ storage, target: null });
    buildExampleFourBar(first.store);
    first.autosave?.flush();

    const second = startSession({ storage, target: null });
    expect(second.restore.status).toBe("restored");
    if (second.restore.status === "restored") {
      expect(second.restore.document).toEqual(first.store.getState().document);
    }
    expect(second.store.getState().document).toEqual(first.store.getState().document);
    expect(second.store.getState().canUndo).toBe(false);

    first.dispose();
    second.dispose();
  });

  it("works with no autosave when storage is null", () => {
    const session = startSession({ storage: null, target: null });
    expect(session.autosave).toBeNull();
    expect(session.restore).toEqual({ status: "empty" });
    session.dispose();
  });

  it("starts empty after a corrupted session, reporting restore.status error, backup already written", () => {
    const storage = createMemoryStorage({ [SESSION_STORAGE_KEY]: "{oops" });
    const session = startSession({ storage, target: null });

    expect(session.restore.status).toBe("error");
    expect(session.store.getState().document.links).toEqual([]);
    expect(storage.getItem(UNREADABLE_SESSION_KEY)).toBe("{oops");

    session.dispose();
  });

  it("registers pagehide on the target and flushes on it; dispose removes the listener and stops autosave", () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    };

    const session = startSession({ storage, target });
    expect(target.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));

    const setItemSpy = vi.spyOn(storage, "setItem");
    buildExampleFourBar(session.store);
    expect(setItemSpy).not.toHaveBeenCalled();

    const pagehide = listeners.get("pagehide");
    if (!pagehide) throw new Error("pagehide listener was not registered");
    pagehide();
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    session.dispose();
    expect(target.removeEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(listeners.has("pagehide")).toBe(false);

    setItemSpy.mockClear();
    session.store.getState().addLink({ name: "extra", sites: [] });
    vi.advanceTimersByTime(1000);
    expect(setItemSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

function createTestStore(): MechanismStore {
  return createMechanismStore();
}
