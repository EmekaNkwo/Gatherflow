import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/result";
import { attendance, ctx, member, NOW, snapshot, task, visitor } from "@/tests/factories";
import type { Household } from "@/types/person";
import { correctPerson, createHousehold, deletePerson, setHousehold } from "./people";

const NOW_ISO = NOW.toISOString();

const household = (overrides: Partial<Household> = {}): Household => ({
  id: "h1",
  name: "Balogun household",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("correctPerson", () => {
  it("trims values, clears blanks and lists what changed", () => {
    const input = snapshot({ people: [visitor({ preferredName: "Tee", householdId: "h1" })] });
    const outcome = unwrap(
      correctPerson(
        input,
        "person_visitor",
        {
          firstName: " Babatunde ",
          preferredName: "  ",
          phone: " 07700 900555 ",
          email: "",
          ageGroup: "youth",
          interests: ["choir"],
          householdId: null,
          notes: "  Prefers evenings ",
        },
        ctx(),
      ),
    );

    const person = outcome.snapshot.people[0];
    expect(person).toMatchObject({
      firstName: "Babatunde",
      lastName: "Balogun",
      preferredName: undefined,
      phone: "07700 900555",
      email: undefined,
      ageGroup: "youth",
      interests: ["choir"],
      householdId: undefined,
      updatedAt: NOW_ISO,
    });
    expect(person.visitor?.notes).toBe("Prefers evenings");
    expect(outcome.snapshot.activity[0].summary).toBe(
      "Record details updated for Tee Balogun (firstName, preferredName, phone, email, ageGroup, interests, householdId, notes).",
    );
    expect(outcome.notices).toEqual(["Record updated."]);
    expect(input.people[0].firstName).toBe("Tunde");
  });

  it("leaves untouched fields alone and ignores keys set to undefined", () => {
    const original = visitor({ householdId: "h1" });
    const outcome = unwrap(
      correctPerson(snapshot({ people: [original] }), "person_visitor", { lastName: "Bello", phone: undefined }, ctx()),
    );
    const person = outcome.snapshot.people[0];
    expect(person).toMatchObject({
      firstName: "Tunde",
      lastName: "Bello",
      phone: original.phone,
      email: original.email,
      householdId: "h1",
      interests: [],
    });
    expect(person.visitor).toEqual(original.visitor);
    expect(outcome.snapshot.activity[0].summary).toBe("Record details updated for Tunde Balogun (lastName).");
  });

  it("assigns a household and clears blank notes", () => {
    const withNotes = visitor({ visitor: { ...visitor().visitor!, notes: "Old note" } });
    const outcome = unwrap(
      correctPerson(
        snapshot({ people: [withNotes], households: [household({ id: "h2" })] }),
        "person_visitor",
        { householdId: "h2", notes: "   " },
        ctx(),
      ),
    );
    expect(outcome.snapshot.people[0].householdId).toBe("h2");
    expect(outcome.snapshot.people[0].visitor?.notes).toBeUndefined();
  });

  it("does not invent a visitor profile for a member when notes are given", () => {
    const outcome = unwrap(correctPerson(snapshot({ people: [member()] }), "person_member", { notes: "x" }, ctx()));
    expect(outcome.snapshot.people[0].visitor).toBeUndefined();
  });

  it.each([
    ["an unknown person", "nobody", { firstName: "A" }, "not_found"],
    ["a blank first name", "person_visitor", { firstName: "  " }, "invalid"],
    ["a blank last name", "person_visitor", { lastName: "" }, "invalid"],
    ["a household that doesn't exist (M4)", "person_visitor", { householdId: "household_nope" }, "not_found"],
  ])("refuses %s", (_label, personId, changes, code) => {
    const outcome = correctPerson(snapshot({ people: [visitor()] }), personId, changes, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });
});

describe("deletePerson", () => {
  it("records the reason in an anonymous audit entry", () => {
    const outcome = unwrap(deletePerson(snapshot({ people: [visitor()] }), "person_visitor", "Asked to be forgotten", ctx()));
    expect(outcome.snapshot.people).toEqual([]);
    expect(outcome.snapshot.activity[0]).toMatchObject({
      type: "system.reset",
      category: "system",
      summary: "A person record and all of its history were deleted — Asked to be forgotten.",
    });
    expect(outcome.snapshot.activity[0].personId).toBeUndefined();
    expect(outcome.notices).toEqual(["Record deleted."]);
  });

  it("clears the person as a household's primary contact and leaves other households", () => {
    const input = snapshot({
      people: [visitor(), member()],
      households: [household({ primaryContactId: "person_visitor" }), household({ id: "h2", primaryContactId: "person_member" })],
    });
    const outcome = unwrap(deletePerson(input, "person_visitor", undefined, ctx()));
    expect(outcome.snapshot.households.map((entry) => entry.primaryContactId)).toEqual([undefined, "person_member"]);
    expect(outcome.snapshot.households[1]).toBe(input.households[1]);
    expect(outcome.snapshot.people.map((person) => person.id)).toEqual(["person_member"]);
    expect(outcome.snapshot.activity[0].summary).toBe("A person record and all of its history were deleted.");
    expect(input.people).toHaveLength(2);
  });

  it("removes the person's own timeline, tasks and attendance but keeps everyone else's", () => {
    const entry = (id: string, personId?: string) => ({
      id,
      type: "visitor.registered" as const,
      category: "visitor" as const,
      personId,
      summary: id,
      at: "2026-10-11T12:00:00.000Z",
      visibility: "general" as const,
    });
    const input = snapshot({
      people: [visitor(), member()],
      activity: [entry("mine", "person_visitor"), entry("theirs", "person_member"), entry("system")],
      tasks: [task(), task({ id: "t_member", personId: "person_member" })],
      attendance: [attendance(), attendance({ id: "a_member", personId: "person_member" })],
    });
    const outcome = unwrap(deletePerson(input, "person_visitor", undefined, ctx()));
    expect(outcome.snapshot.activity.map((event) => event.id)).toEqual(["activity_1", "theirs", "system"]);
    expect(outcome.snapshot.tasks.map((item) => item.id)).toEqual(["t_member"]);
    expect(outcome.snapshot.attendance.map((row) => row.id)).toEqual(["a_member"]);
  });

  it("refuses an unknown person", () => {
    const outcome = deletePerson(snapshot(), "nobody", undefined, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("createHousehold", () => {
  it("creates a household with a trimmed name and area", () => {
    const input = snapshot();
    const outcome = unwrap(createHousehold(input, { name: " Okafor family ", area: " Riverside ", primaryContactId: "p1" }, ctx()));
    expect(outcome.householdId).toBe("household_1");
    expect(outcome.snapshot.households).toEqual([
      { id: "household_1", name: "Okafor family", area: "Riverside", primaryContactId: "p1", createdAt: NOW_ISO },
    ]);
    expect(outcome.notices).toEqual(["Okafor family created."]);
    expect(input.households).toEqual([]);
  });

  it("drops a blank area", () => {
    const outcome = unwrap(createHousehold(snapshot(), { name: "Eze", area: "  " }, ctx()));
    expect(outcome.snapshot.households[0].area).toBeUndefined();
  });

  it("refuses a blank name", () => {
    const outcome = createHousehold(snapshot(), { name: "   " }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid");
  });
});

describe("setHousehold", () => {
  it("moves a person into a household and back out", () => {
    const input = snapshot({ people: [visitor()], households: [household()] });
    const joined = unwrap(setHousehold(input, "person_visitor", "h1", ctx()));
    expect(joined.snapshot.people[0].householdId).toBe("h1");
    expect(joined.notices).toEqual(["Household updated."]);

    const left = unwrap(setHousehold(joined.snapshot, "person_visitor", undefined, ctx()));
    expect(left.snapshot.people[0].householdId).toBeUndefined();
    expect(input.people[0].householdId).toBeUndefined();
  });

  it.each([
    ["an unknown person", "nobody", "h1"],
    ["an unknown household", "person_visitor", "h_gone"],
  ])("refuses %s", (_label, personId, householdId) => {
    const outcome = setHousehold(snapshot({ people: [visitor()], households: [household()] }), personId, householdId, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});
