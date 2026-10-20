import { describe, expect, it } from "vitest";
import { createId, createSequentialIdFactory, nextReference } from "./ids";

describe("createId", () => {
  it("prefixes ids and never repeats one", () => {
    const ids = Array.from({ length: 50 }, () => createId("person"));
    for (const id of ids) expect(id).toMatch(/^person_[0-9a-z]+$/);
    expect(new Set(ids).size).toBe(50);
  });
});

describe("createSequentialIdFactory", () => {
  it("counts per prefix, independently per factory", () => {
    const next = createSequentialIdFactory();
    expect([next("person"), next("person"), next("task"), next("person")]).toEqual([
      "person_1",
      "person_2",
      "task_1",
      "person_3",
    ]);
    expect(createSequentialIdFactory()("person")).toBe("person_1");
  });
});

describe("nextReference", () => {
  it.each<[string, string[], number | undefined, string]>([
    ["MEM", [], undefined, "MEM-0001"],
    ["MEM", ["MEM-0041", "MEM-0007"], undefined, "MEM-0042"],
    ["FU", ["MEM-0099", "FU-0003", "FU-x", "xFU-0050", "FU-0004-b"], undefined, "FU-0004"],
    ["FU", ["FU-9999"], undefined, "FU-10000"],
    ["G", ["G-2"], 2, "G-03"],
  ])("nextReference(%s, %j, %s) is %s", (prefix, existing, padding, expected) => {
    expect(nextReference(prefix, existing, padding)).toBe(expected);
  });
});
