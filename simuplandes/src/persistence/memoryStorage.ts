/**
 * A Map-backed, in-memory implementation of the full `Storage` interface.
 * Used by tests (jsdom-free, deterministic) and by the app when no real
 * storage is available.
 */
export function createMemoryStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(initial ? Object.entries(initial) : []);

  const storage: Storage = {
    get length(): number {
      return map.size;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
  };

  return storage;
}
