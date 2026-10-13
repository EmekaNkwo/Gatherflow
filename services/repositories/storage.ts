/**
 * Storage abstraction.
 *
 * The application never touches `window.localStorage` directly: repositories
 * depend on this interface, so the same code runs against localStorage in the
 * browser and an in-memory map in tests. An IndexedDB adapter can be added
 * here without touching any feature code.
 */
export interface StorageAdapter {
  readonly name: string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Keys currently held by the adapter, used by reset and export. */
  keys(): string[];
}

export function createMemoryStorage(
  initial: Record<string, string> = {},
): StorageAdapter {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    name: "memory",
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    keys: () => Array.from(store.keys()),
  };
}

/**
 * localStorage adapter that degrades to memory when storage is unavailable
 * (private browsing, quota exceeded, server rendering) instead of throwing
 * somewhere deep inside a command.
 */
export function createLocalStorage(): StorageAdapter {
  if (typeof window === "undefined" || !isLocalStorageUsable()) {
    return createMemoryStorage();
  }

  return {
    name: "localStorage",
    getItem: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        console.warn(`[gatherflow] could not persist "${key}"`, error);
      }
    },
    removeItem: (key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    keys: () => {
      try {
        return Object.keys(window.localStorage);
      } catch {
        return [];
      }
    },
  };
}

function isLocalStorageUsable(): boolean {
  try {
    const probe = "__gatherflow_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
