import { describe, expect, it } from "vitest";
import { foldForSearch, matchesPersonQuery } from "./person-search";

const emilie = {
  firstName: "Émilie",
  lastName: "O'Brien-Núñez",
  preferredName: "Emmy",
  phone: "+44 7700 111001",
  email: "emilie@example.com",
  member: { reference: "M-0042" },
};

describe("person search", () => {
  it("ignores accents, case, apostrophes and hyphens", () => {
    expect(foldForSearch("  O'Brien-Núñez ")).toBe("obriennunez");
    expect(matchesPersonQuery(emilie, "emilie")).toBe(true);
    expect(matchesPersonQuery(emilie, "OBRIEN")).toBe(true);
    expect(matchesPersonQuery(emilie, "nunez")).toBe(true);
  });

  it("needs every word, in any field and any order", () => {
    expect(matchesPersonQuery(emilie, "emmy obrien")).toBe(true);
    expect(matchesPersonQuery(emilie, "emi o'b")).toBe(true);
    expect(matchesPersonQuery(emilie, "emilie smith")).toBe(false);
  });

  it("matches a phone number however it was typed", () => {
    expect(matchesPersonQuery(emilie, "07700 111001")).toBe(true);
    expect(matchesPersonQuery(emilie, "7700111001")).toBe(true);
    expect(matchesPersonQuery(emilie, "+44 7700 111001")).toBe(true);
    expect(matchesPersonQuery(emilie, "07700 999999")).toBe(false);
  });

  it("matches email and member reference, and an empty query matches everyone", () => {
    expect(matchesPersonQuery(emilie, "emilie@example")).toBe(true);
    expect(matchesPersonQuery(emilie, "m-0042")).toBe(true);
    expect(matchesPersonQuery(emilie, "   ")).toBe(true);
  });

  it("copes with a person with no optional fields", () => {
    expect(matchesPersonQuery({ firstName: "Ada", lastName: "Obi" }, "ada")).toBe(true);
    expect(matchesPersonQuery({ firstName: "Ada", lastName: "Obi" }, "0770011")).toBe(false);
  });
});
