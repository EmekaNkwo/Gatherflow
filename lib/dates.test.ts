import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  daysBetween,
  describeDueDate,
  formatDisplayDate,
  formatDisplayDateTime,
  formatRelativeFromNow,
  formatShortDate,
  formatTime,
  formatWeekLabel,
  isBeforeIsoDay,
  isFutureDate,
  isPastDate,
  isSameIsoDay,
  isWithinRange,
  parseDate,
  recentWeekStarts,
  toIsoDate,
  toIsoDateTime,
  weekStart,
} from "./dates";

// Local-time dates and zone-less ISO strings keep these tests independent of
// the machine's time zone.
const NOW = new Date(2026, 9, 17, 12, 0, 0); // Saturday 17 Oct 2026, noon local

describe("conversions", () => {
  it.each<[string, Date | string, string]>([
    ["a Date", new Date(2026, 0, 5, 23, 59), "2026-01-05"],
    ["an ISO date", "2026-02-28", "2026-02-28"],
    ["a local ISO date-time", "2026-12-31T23:30:00", "2026-12-31"],
  ])("toIsoDate formats %s as yyyy-MM-dd", (_label, input, expected) => {
    expect(toIsoDate(input)).toBe(expected);
  });

  it("toIsoDateTime returns the UTC ISO string", () => {
    expect(toIsoDateTime(new Date(Date.UTC(2026, 9, 17, 9, 30)))).toBe("2026-10-17T09:30:00.000Z");
  });

  it("parseDate reads an ISO date as local midnight", () => {
    expect(parseDate("2026-10-17")).toEqual(new Date(2026, 9, 17));
  });
});

describe("day arithmetic", () => {
  it.each<[string | Date, number, string]>([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-03-01", -1, "2026-02-28"],
    [new Date(2026, 9, 17), -7, "2026-10-10"],
    ["2026-10-17", 0, "2026-10-17"],
  ])("addDaysIso(%s, %i) is %s", (value, days, expected) => {
    expect(addDaysIso(value, days)).toBe(expected);
  });

  it.each<[string, string, boolean]>([
    ["2026-10-17", "2026-10-17T08:00:00", true],
    ["2026-10-17T23:59:00", "2026-10-17T00:01:00", true],
    ["2026-10-17", "2026-10-18", false],
  ])("isSameIsoDay(%s, %s) is %s", (a, b, expected) => {
    expect(isSameIsoDay(a, b)).toBe(expected);
  });

  it.each<[string, string, boolean]>([
    ["2026-10-16", "2026-10-17", true],
    ["2026-10-17", "2026-10-17", false],
    ["2027-01-01", "2026-12-31", false],
  ])("isBeforeIsoDay(%s, %s) is %s", (value, reference, expected) => {
    expect(isBeforeIsoDay(value, reference)).toBe(expected);
  });

  it.each<[string, string, number]>([
    ["2026-10-17", "2026-10-17", 0],
    ["2026-10-17", "2026-10-20", 3],
    ["2026-10-20", "2026-10-17", -3],
    ["2026-12-31", "2027-01-01", 1],
    ["2026-10-17T23:00:00", "2026-10-18T01:00:00", 1],
  ])("daysBetween(%s, %s) is %i calendar days", (from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });
});

describe("weekStart (Monday-based)", () => {
  it.each<[string | Date, string]>([
    ["2026-10-12", "2026-10-12"], // Monday stays
    ["2026-10-17", "2026-10-12"], // Saturday
    ["2026-10-18", "2026-10-12"], // Sunday belongs to the week before
    ["2026-10-19T08:00:00", "2026-10-19"],
    ["2027-01-01", "2026-12-28"], // across a year boundary
    ["2026-03-01", "2026-02-23"], // across a month boundary
    [new Date(2026, 9, 14), "2026-10-12"],
  ])("weekStart(%s) is %s", (value, expected) => {
    expect(weekStart(value)).toBe(expected);
  });

  it("recentWeekStarts lists the last N week starts, oldest first", () => {
    expect(recentWeekStarts(NOW, 3)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(recentWeekStarts(NOW, 1)).toEqual(["2026-10-12"]);
    expect(recentWeekStarts(NOW, 0)).toEqual([]);
  });
});

describe("ranges and relative position", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };

  it.each<[string, boolean]>([
    ["2026-10-01", true],
    ["2026-10-31T22:00:00", true],
    ["2026-09-30", false],
    ["2026-11-01", false],
  ])("isWithinRange(%s) is %s (inclusive)", (value, expected) => {
    expect(isWithinRange(value, range)).toBe(expected);
  });

  it.each<[string, boolean, boolean]>([
    ["2026-10-18", true, false],
    ["2026-10-17", false, false], // today is neither, whatever the time of day
    ["2026-10-16", false, true],
  ])("%s: future=%s past=%s", (value, future, past) => {
    expect(isFutureDate(value, NOW)).toBe(future);
    expect(isPastDate(value, NOW)).toBe(past);
  });
});

describe("display formatting", () => {
  it.each([
    [formatDisplayDate, "2026-10-07", "7 Oct 2026"],
    [formatShortDate, "2026-10-07T15:00:00", "7 Oct"],
    [formatDisplayDateTime, "2026-10-07T09:05:00", "7 Oct 2026, 09:05"],
    [formatTime, "18:30", "18:30"],
    [formatWeekLabel, "2026-12-28", "28 Dec"],
  ] as const)("%o formats %s as %s", (fn, value, expected) => {
    expect(fn(value)).toBe(expected);
  });

  it.each([formatDisplayDate, formatShortDate, formatDisplayDateTime, formatTime])(
    "%o shows a dash for missing values",
    (fn) => {
      expect(fn(undefined)).toBe("—");
      expect(fn("")).toBe("—");
    },
  );

  it.each([formatDisplayDate, formatShortDate, formatDisplayDateTime])(
    "%o shows 'Unknown date' for an impossible date instead of throwing",
    (fn) => {
      expect(fn("2026-02-31")).toBe("Unknown date");
      expect(fn("not a date")).toBe("Unknown date");
    },
  );
});

describe("describeDueDate", () => {
  it.each<[string, string]>([
    ["2026-10-17", "Today"],
    ["2026-10-18", "Tomorrow"],
    ["2026-10-16", "1 day overdue"],
    ["2026-10-14", "3 days overdue"],
    ["2026-10-22", "In 5 days"],
    ["2026-11-01", "In 15 days"],
  ])("due %s reads %s", (due, expected) => {
    expect(describeDueDate(due, NOW)).toBe(expected);
  });
});

describe("formatRelativeFromNow", () => {
  it.each<[string, string]>([
    ["2026-10-17T08:00:00", "Today"],
    ["2026-10-16T20:00:00", "Yesterday"],
    ["2026-10-14T12:00:00", "3 days ago"],
    ["2026-10-11T12:00:00", "6 days ago"],
    ["2026-10-10T12:00:00", "Last week"],
    ["2026-10-04T12:00:00", "Last week"],
    ["2026-10-03T12:00:00", "2 weeks ago"],
    ["2026-08-19T12:00:00", "8 weeks ago"],
    ["2026-08-18T12:00:00", "18 Aug 2026"],
  ])("%s reads %s", (value, expected) => {
    expect(formatRelativeFromNow(value, NOW)).toBe(expected);
  });
});
