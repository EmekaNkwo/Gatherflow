/**
 * Id generation. Commands receive an id factory through their context so
 * tests can inject a deterministic sequence.
 */

export type IdFactory = (prefix: string) => string;

let counter = 0;

/** Default factory: time-ordered, collision-resistant enough for a demo. */
export const createId: IdFactory = (prefix) => {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
};

/** Deterministic factory for tests: `person_1`, `person_2`, ... */
export function createSequentialIdFactory(): IdFactory {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

/**
 * Human-facing reference such as `MEM-0042` or `FU-0007`. Derived from the
 * highest existing number so references stay stable and readable.
 */
export function nextReference(
  prefix: string,
  existing: readonly string[],
  padding = 4,
): string {
  const highest = existing.reduce((max, value) => {
    const match = value.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) return max;
    return Math.max(max, Number.parseInt(match[1], 10));
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(padding, "0")}`;
}
