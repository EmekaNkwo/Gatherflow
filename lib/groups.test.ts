import { describe, expect, it } from "vitest";
import { meetsLabel } from "./groups";

describe("meetsLabel", () => {
  it("says how often a group meets in words", () => {
    expect(meetsLabel({ weekday: "thursday", time: "18:30", frequency: "fortnightly" } as never)).toBe(
      "Every other Thursday at 18:30",
    );
    expect(meetsLabel({ weekday: "sunday", time: "16:00", frequency: "monthly" } as never)).toBe(
      "Once a month, on a Sunday at 16:00",
    );
    expect(meetsLabel({ weekday: "tuesday", time: "19:00", frequency: "weekly" } as never)).toBe(
      "Every Tuesday at 19:00",
    );
  });
});
