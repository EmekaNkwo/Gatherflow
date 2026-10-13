import {
  addDays,
  differenceInCalendarDays,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfWeek,
} from "date-fns";
import type { IsoDate, IsoDateTime } from "@/types/common";

/**
 * Date helpers. Everything takes an explicit "now" where the answer depends
 * on the current time, so business rules stay deterministic in tests.
 */

export function toIsoDate(value: Date | IsoDateTime | IsoDate): IsoDate {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, "yyyy-MM-dd");
}

export function toIsoDateTime(value: Date): IsoDateTime {
  return value.toISOString();
}

export function parseDate(value: IsoDate | IsoDateTime): Date {
  return parseISO(value);
}

export function addDaysIso(value: IsoDate | Date, days: number): IsoDate {
  const base = typeof value === "string" ? parseISO(value) : value;
  return toIsoDate(addDays(base, days));
}

export function isSameIsoDay(a: IsoDate | IsoDateTime, b: IsoDate | IsoDateTime): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

export function isBeforeIsoDay(value: IsoDate, reference: IsoDate): boolean {
  return value < reference;
}

export function daysBetween(from: IsoDate | IsoDateTime, to: IsoDate | IsoDateTime): number {
  return differenceInCalendarDays(parseDate(to), parseDate(from));
}

/** Monday-based week start, matching how churches report weekly attendance. */
export function weekStart(value: IsoDate | IsoDateTime | Date): IsoDate {
  const date = typeof value === "string" ? parseISO(value) : value;
  return toIsoDate(startOfWeek(date, { weekStartsOn: 1 }));
}

export function isWithinRange(
  value: IsoDate | IsoDateTime,
  range: { from: IsoDate; to: IsoDate },
): boolean {
  const day = toIsoDate(value);
  return day >= range.from && day <= range.to;
}

export function isFutureDate(value: IsoDate, now: Date): boolean {
  return isAfter(parseISO(value), parseISO(toIsoDate(now)));
}

export function isPastDate(value: IsoDate, now: Date): boolean {
  return isBefore(parseISO(value), parseISO(toIsoDate(now)));
}

export function formatDisplayDate(value?: IsoDate | IsoDateTime): string {
  if (!value) return "—";
  return format(parseDate(value), "d MMM yyyy");
}

export function formatShortDate(value?: IsoDate | IsoDateTime): string {
  if (!value) return "—";
  return format(parseDate(value), "d MMM");
}

export function formatDisplayDateTime(value?: IsoDateTime): string {
  if (!value) return "—";
  return format(parseDate(value), "d MMM yyyy, HH:mm");
}

export function formatTime(time?: string): string {
  if (!time) return "—";
  return time;
}

/** "Today", "Tomorrow", "3 days overdue", "in 5 days". */
export function describeDueDate(dueDate: IsoDate, now: Date): string {
  const diff = daysBetween(toIsoDate(now), dueDate);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  return `In ${diff} days`;
}

export function formatRelativeFromNow(value: IsoDateTime, now: Date): string {
  const diff = daysBetween(value, toIsoDateTime(now));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 14) return "Last week";
  if (diff < 60) return `${Math.floor(diff / 7)} weeks ago`;
  return formatDisplayDate(value);
}

/** Inclusive list of the last `count` Monday-based week starts. */
export function recentWeekStarts(now: Date, count: number): IsoDate[] {
  const current = weekStart(now);
  const weeks: IsoDate[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    weeks.push(addDaysIso(current, -7 * index));
  }
  return weeks;
}

export function formatWeekLabel(value: IsoDate): string {
  return format(parseISO(value), "d MMM");
}
