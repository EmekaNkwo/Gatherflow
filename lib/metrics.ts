import type { Ratio } from "@/types/common";

/**
 * Every rate in GatherFlow carries its counts. A zero denominator yields a
 * `null` percentage so the UI can say "no data yet" instead of "0%".
 */
export function ratio(numerator: number, denominator: number): Ratio {
  if (denominator <= 0) {
    return { numerator, denominator: 0, percentage: null };
  }
  return {
    numerator,
    denominator,
    percentage: Math.round((numerator / denominator) * 1000) / 10,
  };
}

export function formatRatio(value: Ratio): string {
  if (value.percentage === null) return "No data yet";
  return `${value.numerator} of ${value.denominator} (${value.percentage}%)`;
}

export function formatPercentage(value: Ratio): string {
  return value.percentage === null ? "—" : `${value.percentage}%`;
}

export function average(values: readonly number[]): number {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

export function countBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K | undefined,
): Record<K, number> {
  return items.reduce(
    (acc, item) => {
      const group = key(item);
      if (!group) return acc;
      acc[group] = (acc[group] ?? 0) + 1;
      return acc;
    },
    {} as Record<K, number>,
  );
}

export function groupBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K,
): Record<K, T[]> {
  return items.reduce(
    (acc, item) => {
      const group = key(item);
      (acc[group] ??= []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}
