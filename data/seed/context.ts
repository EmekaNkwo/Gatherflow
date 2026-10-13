import { toIsoDate, weekStart } from "@/lib/dates";
import { createSequentialIdFactory, type IdFactory } from "@/lib/ids";
import type { IsoDate } from "@/types/common";

/**
 * Seed generation is deterministic: the same "now" always produces the same
 * demo church. Reloading the dashboard can never change a reported figure.
 */

/** mulberry32 — small, fast, good enough for demo data. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedContext {
  now: Date;
  today: IsoDate;
  /** Monday of the current week — the anchor for all generated history. */
  thisWeek: IsoDate;
  random: () => number;
  id: IdFactory;
  pick: <T>(items: readonly T[]) => T;
  /** Integer in `[min, max]`. */
  int: (min: number, max: number) => number;
  chance: (probability: number) => boolean;
}

export function createSeedContext(now: Date): SeedContext {
  const random = createRandom(20260101);
  const id = createSequentialIdFactory();

  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  return {
    now,
    today: toIsoDate(now),
    thisWeek: weekStart(now),
    random,
    id,
    int,
    pick: (items) => items[Math.min(items.length - 1, Math.floor(random() * items.length))],
    chance: (probability) => random() < probability,
  };
}

/** Timestamp helper: an ISO instant on the given day at the given hour. */
export function at(date: IsoDate, hour: number, minute = 0): string {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`).toISOString();
}

export function createIdFactory(): IdFactory {
  return createSequentialIdFactory();
}
