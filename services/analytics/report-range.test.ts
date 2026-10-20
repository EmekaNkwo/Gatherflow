import { describe, expect, it } from "vitest";
import { customRangeProblem } from "./report-range";

describe("customRangeProblem (L2)", () => {
  it.each([
    ["", "2026-10-18", "Choose both a start and an end date."],
    ["2026-09-01", "", "Choose both a start and an end date."],
    ["2026-10-19", "2026-09-01", "The start date is after the end date."],
  ])("refuses %j to %j", (from, to, problem) => {
    expect(customRangeProblem(from, to)).toBe(problem);
  });

  it("accepts a range in order, including a single day", () => {
    expect(customRangeProblem("2026-09-01", "2026-10-18")).toBeNull();
    expect(customRangeProblem("2026-10-18", "2026-10-18")).toBeNull();
  });
});
