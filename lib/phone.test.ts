import { describe, expect, it } from "vitest";
import { isCallingCode, toInternational } from "./phone";

describe("toInternational", () => {
  it.each([
    ["+44 7700 900506", "447700900506"],
    ["07700 900506", "447700900506"],
    ["0044 7700 900506", "447700900506"],
    ["+44 (0)7700 900506", "447700900506"],
    ["7700 900506", "447700900506"],
    ["447700900506", "447700900506"],
    ["+234 803 123 4567", "2348031234567"],
    ["(07700) 900-506", "447700900506"],
  ])("reads %s as %s", (phone, expected) => {
    expect(toInternational(phone)).toBe(expected);
  });

  it("uses the church's own calling code for local numbers", () => {
    expect(toInternational("0803 123 4567", "234")).toBe("2348031234567");
    expect(toInternational("+44 7700 900506", "234")).toBe("447700900506");
  });

  it("falls back to 44 when the church's code is not a real calling code", () => {
    expect(toInternational("07700 900506", "0x")).toBe("447700900506");
  });

  it.each([undefined, "", "   ", "call the office", "12345", "+44 7700 900506 ext 4", "44+7700900506", "+0 7700 900506", "+1234567890123456"])(
    "offers nothing for %j",
    (phone) => {
      expect(toInternational(phone)).toBeUndefined();
    },
  );
});

describe("isCallingCode", () => {
  it.each([["44", true], ["1", true], ["234", true], ["0", false], ["1234", false], ["+44", false], ["", false]])(
    "%s → %s",
    (code, expected) => {
      expect(isCallingCode(code)).toBe(expected);
    },
  );
});
