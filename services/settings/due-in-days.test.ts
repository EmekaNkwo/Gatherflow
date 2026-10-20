import { describe, expect, it } from "vitest";
import { checkDueInDays } from "./due-in-days";

describe("checkDueInDays", () => {
  it.each([
    ["0", 0],
    ["14", 14],
    [" 21 ", 21],
    ["90", 90],
  ])("reads %j as %i", (raw, days) => {
    expect(checkDueInDays(raw)).toEqual({ ok: true, value: days });
  });

  it.each([
    ["", "Enter a number of days, from 0 to 90."],
    ["   ", "Enter a number of days, from 0 to 90."],
    ["-3", "Use a whole number of days, such as 3."],
    ["2.5", "Use a whole number of days, such as 3."],
    ["100", "Choose between 0 and 90 days."],
  ])("refuses %j with a plain message", (raw, error) => {
    expect(checkDueInDays(raw)).toMatchObject({ ok: false, error });
  });
});
