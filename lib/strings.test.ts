import { describe, expect, it } from "vitest";
import {
  displayName,
  editDistance,
  fullName,
  initials,
  normalise,
  normaliseEmail,
  normalisePhone,
  pluralise,
  titleCase,
  truncate,
} from "./strings";

describe("names", () => {
  it.each<[{ firstName: string; lastName: string; preferredName?: string }, string, string]>([
    [{ firstName: "Robert", lastName: "Okafor" }, "Robert Okafor", "Robert Okafor"],
    [{ firstName: "Robert", lastName: "Okafor", preferredName: "Bobby" }, "Robert Okafor", "Bobby Okafor"],
    [{ firstName: "Robert", lastName: "Okafor", preferredName: "   " }, "Robert Okafor", "Robert Okafor"],
    [{ firstName: "Robert", lastName: "Okafor", preferredName: " Rob " }, "Robert Okafor", "Rob Okafor"],
    [{ firstName: "Cher", lastName: "" }, "Cher", "Cher"],
  ])("%j → full %s, display %s", (person, full, display) => {
    expect(fullName(person)).toBe(full);
    expect(displayName(person)).toBe(display);
  });

  it.each<[string, string, string]>([
    ["ada", "lovelace", "AL"],
    ["Émile", "zola", "ÉZ"],
    ["Cher", "", "C"],
  ])("initials of %s %s are %s", (firstName, lastName, expected) => {
    expect(initials({ firstName, lastName })).toBe(expected);
  });
});

describe("normalisation", () => {
  it("normalise trims, lower-cases and collapses whitespace", () => {
    expect(normalise("  Mary   ANNE\tSmith \n")).toBe("mary anne smith");
  });

  it.each<[string | undefined, string]>([
    [undefined, ""],
    ["", ""],
    ["+44 7700 900123", "700900123"],
    ["07700 900123", "700900123"],
    ["7700900123", "700900123"],
    ["(020) 123", "020123"],
    ["123456789", "123456789"],
  ])("normalisePhone(%s) is %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each<[string | undefined, string]>([
    [undefined, ""],
    ["  Ada@Example.ORG ", "ada@example.org"],
  ])("normaliseEmail(%s) is %s", (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected);
  });
});

describe("editDistance", () => {
  it.each<[string, string, number]>([
    ["same", "same", 0],
    ["", "abc", 3],
    ["abc", "", 3],
    ["kitten", "sitting", 3],
    ["jon", "john", 1],
    ["smith", "smyth", 1],
    ["ab", "ba", 2],
    ["flaw", "lawn", 2],
  ])("editDistance(%s, %s) is %i", (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
    expect(editDistance(b, a)).toBe(expected);
  });
});

describe("text helpers", () => {
  it.each<[string, string]>([
    ["follow_up_coordinator", "Follow Up Coordinator"],
    ["new-VISITOR", "New Visitor"],
    ["  two  words ", "Two Words"],
    ["", ""],
  ])("titleCase(%s) is %s", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each<[number, string, string | undefined, string]>([
    [1, "visitor", undefined, "visitor"],
    [0, "visitor", undefined, "visitors"],
    [2, "visitor", undefined, "visitors"],
    [2, "person", "people", "people"],
    [1, "person", "people", "person"],
  ])("pluralise(%i, %s, %s) is %s", (count, singular, plural, expected) => {
    expect(pluralise(count, singular, plural)).toBe(expected);
  });

  it.each<[string, number, string]>([
    ["short", 10, "short"],
    ["exactly10!", 10, "exactly10!"],
    ["much too long", 5, "much…"],
  ])("truncate(%s, %i) is %s", (value, max, expected) => {
    expect(truncate(value, max)).toBe(expected);
  });
});
