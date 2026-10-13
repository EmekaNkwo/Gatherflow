import type { z } from "zod";
import type { StorageAdapter } from "./storage";

export const STORAGE_NAMESPACE = "gatherflow";
export const SCHEMA_VERSION = 1;

/**
 * Repository pattern: business logic depends on these operations, never on
 * the storage mechanism. Each collection is stored under its own key in a
 * versioned envelope so a future schema change can migrate one collection at
 * a time.
 */
export interface Repository<T extends { id: string }> {
  readonly key: string;
  findAll(): T[];
  findById(id: string): T | undefined;
  saveAll(items: readonly T[]): void;
  clear(): void;
}

export interface LoadReport {
  /** Records that failed validation and were dropped. */
  dropped: number;
  /** Human-readable notes for the UI ("3 invalid visitor records ignored"). */
  issues: string[];
}

export interface CollectionRepository<T extends { id: string }> extends Repository<T> {
  /** Returns `null` when nothing has been persisted yet. */
  load(report: LoadReport): T[] | null;
}

interface Envelope {
  version: number;
  savedAt: string;
  data: unknown;
}

export function storageKey(collection: string): string {
  return `${STORAGE_NAMESPACE}:v${SCHEMA_VERSION}:${collection}`;
}

export function createCollectionRepository<T extends { id: string }>(
  adapter: StorageAdapter,
  collection: string,
  schema: z.ZodType<T>,
): CollectionRepository<T> {
  const key = storageKey(collection);

  function readEnvelope(): Envelope | null {
    const raw = adapter.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("version" in parsed) ||
        !("data" in parsed)
      ) {
        return null;
      }
      return parsed as Envelope;
    } catch {
      return null;
    }
  }

  function load(report: LoadReport): T[] | null {
    const envelope = readEnvelope();
    if (!envelope) return null;

    if (!Array.isArray(envelope.data)) {
      report.issues.push(`Stored ${collection} data was not a list and was ignored.`);
      return null;
    }

    const items: T[] = [];
    let dropped = 0;

    for (const candidate of envelope.data) {
      const result = schema.safeParse(candidate);
      if (result.success) {
        items.push(result.data);
      } else {
        dropped += 1;
      }
    }

    if (dropped > 0) {
      report.dropped += dropped;
      report.issues.push(
        `${dropped} invalid ${collection} record${dropped === 1 ? "" : "s"} were ignored.`,
      );
    }

    return items;
  }

  return {
    key,
    load,
    findAll() {
      return load({ dropped: 0, issues: [] }) ?? [];
    },
    findById(id) {
      return this.findAll().find((item) => item.id === id);
    },
    saveAll(items) {
      const envelope: Envelope = {
        version: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        data: items,
      };
      adapter.setItem(key, JSON.stringify(envelope));
    },
    clear() {
      adapter.removeItem(key);
    },
  };
}

/** Single-document store, used for church settings. */
export interface DocumentRepository<T> {
  readonly key: string;
  load(report: LoadReport): T | null;
  save(value: T): void;
  clear(): void;
}

export function createDocumentRepository<T>(
  adapter: StorageAdapter,
  collection: string,
  schema: z.ZodType<T>,
): DocumentRepository<T> {
  const key = storageKey(collection);

  return {
    key,
    load(report) {
      const raw = adapter.getItem(key);
      if (!raw) return null;
      try {
        const envelope = JSON.parse(raw) as Envelope;
        const result = schema.safeParse(envelope?.data);
        if (result.success) return result.data;
        report.issues.push(`Stored ${collection} were invalid and the defaults were restored.`);
        return null;
      } catch {
        report.issues.push(`Stored ${collection} could not be read and the defaults were restored.`);
        return null;
      }
    },
    save(value) {
      const envelope: Envelope = {
        version: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        data: value,
      };
      adapter.setItem(key, JSON.stringify(envelope));
    },
    clear() {
      adapter.removeItem(key);
    },
  };
}
