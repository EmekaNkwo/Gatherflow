import { describe, expect, it } from "vitest";
import { member, visitor } from "@/tests/factories";
import type { Person } from "@/types/person";
import { findPotentialDuplicates, hasLikelyDuplicate, type DuplicateMatch } from "./duplicates";

const people: Person[] = [
  visitor({ id: "p_phone", firstName: "Tunde", lastName: "Balogun", phone: "+44 7700 900111", email: undefined }),
  visitor({ id: "p_email", firstName: "Kemi", lastName: "Oladipo", phone: undefined, email: "Kemi@Example.com" }),
  member({ id: "p_name", firstName: "Grace", lastName: "Adeyemi", phone: undefined }),
  visitor({ id: "p_similar_first", firstName: "Jon", lastName: "Smith", phone: undefined, email: undefined }),
  visitor({ id: "p_last_only", firstName: "Bartholomew", lastName: "Smith", phone: undefined, email: undefined }),
  visitor({ id: "p_similar_last", firstName: "Ruth", lastName: "Okonkwo", phone: undefined, email: undefined }),
];

const summary = (matches: DuplicateMatch[]) =>
  matches.map((match) => [match.person.id, match.confidence, match.reason]);

describe("findPotentialDuplicates", () => {
  it("matches the same phone number in a different format", () => {
    expect(summary(findPotentialDuplicates(people, { firstName: "T", lastName: "B", phone: "07700900111" }))).toEqual([
      ["p_phone", "high", "Same phone number"],
    ]);
  });

  it("matches email case-insensitively", () => {
    expect(summary(findPotentialDuplicates(people, { firstName: "", lastName: "", email: " kemi@example.COM " }))).toEqual([
      ["p_email", "high", "Same email address"],
    ]);
  });

  it("matches an exact name", () => {
    expect(summary(findPotentialDuplicates(people, { firstName: "grace", lastName: "ADEYEMI" }))).toEqual([
      ["p_name", "high", "Same first and last name"],
    ]);
  });

  it("ranks a similar first name above a bare last-name match", () => {
    expect(summary(findPotentialDuplicates(people, { firstName: "John", lastName: "Smith" }))).toEqual([
      ["p_similar_first", "medium", "Same last name and a very similar first name (Jon)"],
      ["p_last_only", "low", "Same last name"],
    ]);
  });

  it("matches a same first name with a similar last name", () => {
    expect(summary(findPotentialDuplicates(people, { firstName: "Ruth", lastName: "Okonkwu" }))).toEqual([
      ["p_similar_last", "medium", "Same first name and a very similar last name (Okonkwo)"],
    ]);
  });

  it("ignores a same first name when the last name is far off", () => {
    expect(findPotentialDuplicates(people, { firstName: "Ruth", lastName: "Williams" })).toEqual([]);
  });

  it("never matches the record being edited", () => {
    expect(
      findPotentialDuplicates(people, { firstName: "Grace", lastName: "Adeyemi", excludeId: "p_name" }),
    ).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(findPotentialDuplicates(people, { firstName: "  ", lastName: "" })).toEqual([]);
  });

  it("respects the limit after ranking", () => {
    const matches = findPotentialDuplicates(people, { firstName: "John", lastName: "Smith" }, 1);
    expect(summary(matches)).toEqual([
      ["p_similar_first", "medium", "Same last name and a very similar first name (Jon)"],
    ]);
  });

  it("does not reorder the people it was given", () => {
    const copy = [...people];
    findPotentialDuplicates(people, { firstName: "John", lastName: "Smith" });
    expect(people).toEqual(copy);
  });
});

describe("hasLikelyDuplicate", () => {
  it("is true only when there is a high-confidence match", () => {
    expect(hasLikelyDuplicate(findPotentialDuplicates(people, { firstName: "Grace", lastName: "Adeyemi" }))).toBe(true);
    expect(hasLikelyDuplicate(findPotentialDuplicates(people, { firstName: "John", lastName: "Smith" }))).toBe(false);
    expect(hasLikelyDuplicate([])).toBe(false);
  });
});
