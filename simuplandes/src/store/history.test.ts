import { describe, expect, it } from "vitest";
import { produceWithPatches, enablePatches } from "immer";
import { createHistory, DEFAULT_HISTORY_LIMIT, type HistoryEntry } from "./history";

enablePatches();

interface TinyState {
  items: number[];
  name: string;
}

function makeInitial(): TinyState {
  return { items: [], name: "start" };
}

/** Builds a history entry that pushes `value` onto `items`, via produceWithPatches. */
function pushEntry(
  base: TinyState,
  value: number,
  label = `push-${value}`,
  coalesceKey?: string,
): { next: TinyState; entry: HistoryEntry } {
  const [next, patches, inversePatches] = produceWithPatches(base, (draft) => {
    draft.items.push(value);
  });
  return {
    next,
    entry: {
      label,
      patches,
      inversePatches,
      ...(coalesceKey !== undefined ? { coalesceKey } : {}),
    },
  };
}

describe("createHistory", () => {
  it("round-trips 150 recorded entries: undo back to initial, redo back to final", () => {
    const history = createHistory<TinyState>();
    let state = makeInitial();
    const initial = state;
    for (let i = 1; i <= 150; i += 1) {
      const { next, entry } = pushEntry(state, i);
      state = next;
      history.record(entry);
    }
    const final = state;
    expect(history.pastCount).toBe(150);
    expect(history.futureCount).toBe(0);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    for (let i = 0; i < 150; i += 1) {
      const undone = history.undo(state);
      expect(undone).not.toBeNull();
      state = undone as TinyState;
    }
    expect(state).toEqual(initial);
    expect(history.canUndo).toBe(false);
    expect(history.pastCount).toBe(0);
    expect(history.futureCount).toBe(150);

    for (let i = 0; i < 150; i += 1) {
      const redone = history.redo(state);
      expect(redone).not.toBeNull();
      state = redone as TinyState;
    }
    expect(state).toEqual(final);
    expect(history.canRedo).toBe(false);
    expect(history.pastCount).toBe(150);
    expect(history.futureCount).toBe(0);
  });

  it("undo()/redo() on an empty stack return null", () => {
    const history = createHistory<TinyState>();
    const state = makeInitial();
    expect(history.undo(state)).toBeNull();
    expect(history.redo(state)).toBeNull();
  });

  it("limit: recording 600 entries with limit 500 leaves pastCount 500, dropping the oldest 100", () => {
    const history = createHistory<TinyState>({ limit: 500 });
    let state = makeInitial();
    let stateAfter100: TinyState | null = null;
    for (let i = 1; i <= 600; i += 1) {
      const { next, entry } = pushEntry(state, i);
      state = next;
      history.record(entry);
      if (i === 100) stateAfter100 = state;
    }
    expect(history.pastCount).toBe(500);
    expect(DEFAULT_HISTORY_LIMIT).toBe(500);

    for (let i = 0; i < 500; i += 1) {
      const undone = history.undo(state);
      expect(undone).not.toBeNull();
      state = undone as TinyState;
    }
    expect(state).toEqual(stateAfter100);
    expect(history.canUndo).toBe(false);
  });

  it("recording after an undo clears the future", () => {
    const history = createHistory<TinyState>();
    let state = makeInitial();
    const { next: s1, entry: e1 } = pushEntry(state, 1);
    state = s1;
    history.record(e1);
    const { next: s2, entry: e2 } = pushEntry(state, 2);
    state = s2;
    history.record(e2);

    const undone = history.undo(state);
    expect(undone).not.toBeNull();
    state = undone as TinyState;
    expect(history.canRedo).toBe(true);

    const { entry: e3 } = pushEntry(state, 3);
    history.record(e3);
    expect(history.canRedo).toBe(false);
    expect(history.futureCount).toBe(0);
  });

  it("coalescing: entries sharing a coalesceKey merge into one history entry", () => {
    const history = createHistory<TinyState>();
    let state = makeInitial();
    const before = state;

    const { next: s1, entry: e1 } = pushEntry(state, 1, "push-1", "drag-1");
    state = s1;
    history.record(e1);
    expect(history.pastCount).toBe(1);

    const { next: s2, entry: e2 } = pushEntry(state, 2, "push-2", "drag-1");
    state = s2;
    history.record(e2);
    expect(history.pastCount).toBe(1);

    const afterCoalesced = state;
    const undone = history.undo(state);
    expect(undone).not.toBeNull();
    expect(undone).toEqual(before);
    state = undone as TinyState;

    // redo restores the fully-coalesced state
    const redone = history.redo(state);
    expect(redone).toEqual(afterCoalesced);
    state = redone as TinyState;

    // a following record with a different key starts a new entry
    const { next: s3, entry: e3 } = pushEntry(state, 3, "push-3", "drag-2");
    state = s3;
    history.record(e3);
    expect(history.pastCount).toBe(2);

    // a following record with no key starts a new entry
    const { entry: e4 } = pushEntry(state, 4, "push-4");
    history.record(e4);
    expect(history.pastCount).toBe(3);
  });

  it("after an undo, a record with the old coalesceKey does NOT merge into the now-top entry", () => {
    const history = createHistory<TinyState>();
    let state = makeInitial();

    const { next: s1, entry: e1 } = pushEntry(state, 1, "push-1", "drag-1");
    state = s1;
    history.record(e1);

    const { next: s2, entry: e2 } = pushEntry(state, 2, "push-2", "drag-2");
    state = s2;
    history.record(e2);
    expect(history.pastCount).toBe(2);

    const undone = history.undo(state);
    state = undone as TinyState;
    expect(history.pastCount).toBe(1);
    expect(history.futureCount).toBe(1);

    // record with "drag-1" (the key of the now-top past entry) must NOT merge
    const { entry: e3 } = pushEntry(state, 3, "push-3", "drag-1");
    history.record(e3);
    expect(history.pastCount).toBe(2);
    expect(history.futureCount).toBe(0);
  });

  it("undoLabel/redoLabel return the label of the entry that would be undone/redone, or null", () => {
    const history = createHistory<TinyState>();
    let state = makeInitial();
    expect(history.undoLabel).toBeNull();
    expect(history.redoLabel).toBeNull();

    const { next: s1, entry: e1 } = pushEntry(state, 1, "first");
    state = s1;
    history.record(e1);
    expect(history.undoLabel).toBe("first");
    expect(history.redoLabel).toBeNull();

    const { next: s2, entry: e2 } = pushEntry(state, 2, "second");
    state = s2;
    history.record(e2);
    expect(history.undoLabel).toBe("second");

    history.undo(state);
    expect(history.undoLabel).toBe("first");
    expect(history.redoLabel).toBe("second");
  });

  it("clear() empties both stacks", () => {
    const history = createHistory<TinyState>();
    let state = makeInitial();
    const { next: s1, entry: e1 } = pushEntry(state, 1);
    state = s1;
    history.record(e1);
    history.undo(state);
    expect(history.futureCount).toBe(1);

    history.clear();
    expect(history.pastCount).toBe(0);
    expect(history.futureCount).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoLabel).toBeNull();
    expect(history.redoLabel).toBeNull();
  });

  it("each createHistory() instance is isolated", () => {
    const a = createHistory<TinyState>();
    const b = createHistory<TinyState>();
    const state = makeInitial();
    const { entry } = pushEntry(state, 1);
    a.record(entry);
    expect(a.pastCount).toBe(1);
    expect(b.pastCount).toBe(0);
  });
});
