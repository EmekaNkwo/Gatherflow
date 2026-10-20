import { describe, expect, it } from "vitest";
import { average, countBy, formatPercentage, formatRatio, groupBy, ratio, unique } from "./metrics";

describe("ratio", () => {
  it.each<[number, number, { numerator: number; denominator: number; percentage: number | null }]>([
    [1, 3, { numerator: 1, denominator: 3, percentage: 33.3 }],
    [2, 3, { numerator: 2, denominator: 3, percentage: 66.7 }],
    [0, 5, { numerator: 0, denominator: 5, percentage: 0 }],
    [5, 5, { numerator: 5, denominator: 5, percentage: 100 }],
    [3, 0, { numerator: 3, denominator: 0, percentage: null }],
    [3, -2, { numerator: 3, denominator: 0, percentage: null }],
  ])("ratio(%i, %i)", (numerator, denominator, expected) => {
    expect(ratio(numerator, denominator)).toEqual(expected);
  });

  it("formats a ratio with its counts, or says there is no data", () => {
    expect(formatRatio(ratio(1, 3))).toBe("1 of 3 (33.3%)");
    expect(formatRatio(ratio(0, 0))).toBe("No data yet");
  });

  it("formats a percentage alone, or a dash", () => {
    expect(formatPercentage(ratio(1, 4))).toBe("25%");
    expect(formatPercentage(ratio(1, 0))).toBe("—");
  });
});

describe("average", () => {
  it.each<[number[], number]>([
    [[], 0],
    [[4], 4],
    [[1, 2], 1.5],
    [[1, 1, 2], 1.3],
    [[10, 20, 31], 20.3],
  ])("average(%j) is %d", (values, expected) => {
    expect(average(values)).toBe(expected);
  });
});

describe("grouping helpers", () => {
  const items = [
    { kind: "visitor", name: "A" },
    { kind: "member", name: "B" },
    { kind: "visitor", name: "C" },
    { kind: undefined, name: "D" },
  ] as const;

  it("countBy counts per key and skips items without one", () => {
    expect(countBy(items, (item) => item.kind)).toEqual({ visitor: 2, member: 1 });
    expect(countBy([], () => "x")).toEqual({});
  });

  it("groupBy keeps every item under its key, in order", () => {
    expect(groupBy(items, (item) => item.kind ?? "none")).toEqual({
      visitor: [items[0], items[2]],
      member: [items[1]],
      none: [items[3]],
    });
  });

  it("unique removes duplicates keeping first occurrence order", () => {
    expect(unique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
    expect(unique([])).toEqual([]);
  });
});
