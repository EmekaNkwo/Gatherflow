import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { group, member, session, snapshot, task, visitor } from "@/tests/factories";
import { globalSearch } from "./global-search";

const data = snapshot({
  people: [
    visitor({ id: "v1", firstName: "Grace", lastName: "Okafor", preferredName: "Gee" }),
    member({ id: "m1", firstName: "Grace", lastName: "Adeyemi", email: "grace@example.com" }),
    member({
      id: "m2",
      firstName: "Femi",
      lastName: "Bello",
      member: { ...member().member!, reference: "MEM-0099", status: "new_member" },
    }),
  ],
  tasks: [
    task({ id: "t_amara", reference: "FU-0001", personId: "v1", type: "welcome_message", dueDate: "2026-10-12" }),
    task({ id: "t_coord", reference: "FU-0002", personId: "m1", assigneeId: TEAM_IDS.coordinator, notes: "Grace asked for a call" }),
    task({ id: "t_orphan", reference: "FU-0003", personId: "gone", notes: "grace period", type: "phone_call" }),
  ],
  groups: [
    group({ id: "g1", name: "Grace Choir", description: "Sunday singers", members: [] }),
    group({ id: "g2", name: "Men's breakfast", description: "Grace and coffee", active: false }),
  ],
  sessions: [session({ id: "s1", name: "Grace night", date: "2026-10-16" }), session({ id: "s2" })],
});

const kindsAndIds = (results: { kind: string; id: string }[]) => results.map((result) => `${result.kind}:${result.id}`);

describe("globalSearch", () => {
  it("finds every kind of record, grouped by kind", () => {
    expect(kindsAndIds(globalSearch(data, "grace", { role: "administrator" }))).toEqual([
      "visitor:v1",
      "member:m1",
      "task:t_coord",
      "task:t_orphan",
      "group:g1",
      "group:g2",
      "session:s1",
    ]);
  });

  it("describes each result for display", () => {
    const results = [
      ...globalSearch(data, "grace", { role: "administrator" }),
      ...globalSearch(data, "fu-0001", { role: "administrator" }),
    ];
    const byId = Object.fromEntries(results.map((result) => [result.id, result]));
    expect(byId.v1).toEqual({
      kind: "visitor",
      id: "v1",
      title: "Gee Okafor",
      subtitle: "Visitor · first visit 4 Oct 2026",
      href: "/visitors/v1",
    });
    expect(byId.m1).toMatchObject({ title: "Grace Adeyemi", subtitle: "Member MEM-0001 · active", href: "/members/m1" });
    expect(byId.t_amara).toMatchObject({
      title: "FU-0001 · welcome message",
      subtitle: "Gee Okafor · due 12 Oct 2026",
      href: "/follow-ups/tasks?task=t_amara",
    });
    expect(byId.t_orphan).toMatchObject({ title: "FU-0003 · phone call", subtitle: "Unknown person · due 12 Oct 2026" });
    expect(byId.g1).toMatchObject({ subtitle: "0 members", href: "/groups/g1" });
    expect(byId.g2).toMatchObject({ subtitle: "0 members · inactive" });
    expect(byId.s1).toEqual({
      kind: "session",
      id: "s1",
      title: "Grace night",
      subtitle: "16 Oct 2026",
      href: "/attendance/s1",
    });
  });

  it.each([
    ["a member reference", "mem-0099", ["member:m2"]],
    ["an email", "grace@example", ["member:m1"]],
    ["a preferred name", "gee", ["visitor:v1", "task:t_amara"]],
    ["a task reference", "fu-0002", ["task:t_coord"]],
    ["a session date", "2026-10-16", ["session:s1"]],
  ])("matches %s", (_label, query, expected) => {
    expect(kindsAndIds(globalSearch(data, query, { role: "follow_up_coordinator" }))).toEqual(expected);
  });

  it("shows a status with underscores as words", () => {
    expect(globalSearch(data, "femi", { role: "pastor" })[0].subtitle).toBe("Member MEM-0099 · new member");
  });

  it("limits a volunteer to their own tasks", () => {
    const own = globalSearch(data, "fu-000", { role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    expect(kindsAndIds(own)).toEqual(["task:t_amara", "task:t_orphan"]);

    const anonymous = globalSearch(data, "fu-000", { role: "volunteer" });
    expect(anonymous.some((result) => result.kind === "task")).toBe(false);
  });

  it("still lets the member role find groups and sessions, but no people or tasks", () => {
    expect(kindsAndIds(globalSearch(data, "grace", { role: "member" }))).toEqual(["group:g1", "group:g2", "session:s1"]);
  });

  it("applies the limit after grouping", () => {
    expect(kindsAndIds(globalSearch(data, "grace", { role: "administrator", limit: 3 }))).toEqual([
      "visitor:v1",
      "member:m1",
      "task:t_coord",
    ]);
  });

  it.each(["", " g ", "  "])("ignores the too-short query %j", (query) => {
    expect(globalSearch(data, query, { role: "administrator" })).toEqual([]);
  });

  it("normalises spacing and case in the query", () => {
    expect(kindsAndIds(globalSearch(data, "  GRACE   NIGHT ", { role: "administrator" }))).toEqual(["session:s1"]);
  });
});

describe("globalSearch finds people the way the app shows them (M1)", () => {
  const people = snapshot({
    people: [
      member({
        id: "steve",
        firstName: "Stephen",
        lastName: "Achebe",
        preferredName: "Steve",
        phone: "+44 7700 900010",
      }),
      visitor({ id: "chloe", firstName: "Chloé", lastName: "O'Brien", phone: undefined, email: undefined }),
    ],
  });
  const find = (query: string) =>
    kindsAndIds(globalSearch(people, query, { role: "administrator" }));

  it.each([
    ["the preferred name and surname", "Steve Achebe", ["member:steve"]],
    ["words in any order", "Achebe Stephen", ["member:steve"]],
    ["a local-format phone number", "07700 900010", ["member:steve"]],
    ["a name without its accent", "chloe obrien", ["visitor:chloe"]],
  ])("by %s", (_label, query, expected) => {
    expect(find(query)).toEqual(expected);
  });
});
