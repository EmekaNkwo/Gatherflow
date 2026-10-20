import { describe, expect, it } from "vitest";
import { attendance, group, member, NOW, session, snapshot, task, visitor } from "@/tests/factories";
import type { MemberProfile, MembershipStatus, Person } from "@/types/person";
import {
  groupParticipation,
  MEMBER_EXPORT_COLUMNS,
  MEMBER_FILTER_LABELS,
  memberRows,
  membershipBreakdown,
  selectMembers,
  type MemberFilter,
} from "./selectors";

function memberWith(
  id: string,
  firstName: string,
  lastName: string,
  status: MembershipStatus,
  profile: Partial<MemberProfile> = {},
  rest: Partial<Person> = {},
): Person {
  const base = member().member!;
  return member({ id, firstName, lastName, ...rest, member: { ...base, status, ...profile } });
}

/** Six members, one per status, plus a visitor who must never appear. */
function church() {
  return snapshot({
    households: [{ id: "h1", name: "Adeyemi household", createdAt: "2024-01-01T00:00:00.000Z" }],
    groups: [group({ id: "g1" }), group({ id: "g2", name: "Choir", active: false })],
    people: [
      memberWith("m_fox", "Finn", "Fox", "archived", { reference: "MEM-0006" }),
      memberWith(
        "m_active",
        "Grace",
        "Adeyemi",
        "active",
        { reference: "MEM-0001" },
        { householdId: "h1", groupIds: ["g1", "g2", "g_missing"] },
      ),
      memberWith("m_lapsed", "Ben", "Brown", "active", { reference: "MEM-0002", membershipDate: "2025-06-01" }, { groupIds: ["g_missing"] }),
      memberWith(
        "m_new",
        "Cara",
        "Clark",
        "new_member",
        { reference: "MEM-0003", membershipDate: "2026-09-01", requestedContact: true, preferredServiceType: "midweek_service" },
        { email: "cara@example.com", preferredName: "CeeCee" },
      ),
      memberWith("m_inactive", "Dan", "Davis", "inactive", { reference: "MEM-0004" }, { groupIds: ["g2"] }),
      memberWith("m_transferred", "Eve", "Evans", "transferred", { reference: "MEM-0005" }),
      visitor({ id: "v1" }),
    ],
    sessions: [
      session({ id: "s_a", date: "2026-10-11" }),
      session({ id: "s_b", date: "2026-10-04" }),
      session({ id: "s_c", date: "2026-08-09" }),
      session({ id: "s_d", date: "2026-06-07" }),
    ],
    attendance: [
      attendance({ id: "a1", sessionId: "s_a", personId: "m_active", firstVisit: false }),
      attendance({ id: "a2", sessionId: "s_b", personId: "m_active", firstVisit: false }),
      attendance({ id: "a3", sessionId: "s_c", personId: "m_lapsed", firstVisit: false }),
      attendance({ id: "a4", sessionId: "s_d", personId: "m_inactive", firstVisit: false }),
      attendance({ id: "a5", sessionId: "s_a", personId: "m_lapsed", status: "removed", firstVisit: false }),
    ],
    tasks: [
      task({ id: "t1", personId: "m_active" }),
      task({ id: "t2", personId: "m_active", status: "completed" }),
      task({ id: "t3", personId: "m_active", status: "in_progress" }),
    ],
  });
}

const ids = (rows: { person: Person }[]) => rows.map((row) => row.person.id);

describe("memberRows", () => {
  it("lists every member (archived included) sorted by surname, never visitors", () => {
    expect(ids(memberRows(church(), NOW))).toEqual([
      "m_active",
      "m_lapsed",
      "m_new",
      "m_inactive",
      "m_transferred",
      "m_fox",
    ]);
  });

  it("joins household, groups, attendance and open tasks", () => {
    const row = memberRows(church(), NOW)[0];
    expect(row).toMatchObject({
      reference: "MEM-0001",
      status: "active",
      statusLabel: "Active",
      membershipDate: "2024-03-10",
      householdName: "Adeyemi household",
      groupNames: ["Riverside Connect Group", "Choir"],
      lastAttendance: "2026-10-11",
      weeksSinceAttendance: 0,
      recentWeeks: 2,
      openTaskCount: 2,
      reviewReason: undefined,
    });
  });

  it("flags an active member who has been absent past the threshold", () => {
    const row = memberRows(church(), NOW).find((entry) => entry.person.id === "m_lapsed")!;
    expect(row.weeksSinceAttendance).toBe(9);
    expect(row.lastAttendance).toBe("2026-08-09");
    expect(row.reviewReason).toBe(
      "No attendance recorded for 9 weeks (the church's review threshold is 8).",
    );
  });

  it("does not flag inactive members or people never recorded", () => {
    const rows = memberRows(church(), NOW);
    const inactive = rows.find((entry) => entry.person.id === "m_inactive")!;
    expect(inactive.weeksSinceAttendance).toBe(18);
    expect(inactive.reviewReason).toBeUndefined();

    const fresh = rows.find((entry) => entry.person.id === "m_new")!;
    expect(fresh.weeksSinceAttendance).toBeUndefined();
    expect(fresh.lastAttendance).toBeUndefined();
    expect(fresh.recentWeeks).toBe(0);
    expect(fresh.reviewReason).toBeUndefined();
    expect(fresh.householdName).toBeUndefined();
  });

  it("is empty when there are no members", () => {
    expect(memberRows(snapshot({ people: [visitor()] }), NOW)).toEqual([]);
  });
});

describe("selectMembers", () => {
  it.each<[MemberFilter, string[]]>([
    // Current members only: transferred and archived have their own views.
    ["all", ["m_active", "m_lapsed", "m_new", "m_inactive"]],
    ["active", ["m_active", "m_lapsed"]],
    ["new", ["m_new"]],
    ["inactive", ["m_inactive"]],
    ["transferred", ["m_transferred"]],
    ["archived", ["m_fox"]],
    ["requested_contact", ["m_new"]],
    // m_inactive is only in an inactive group, so counts as not in a group;
    // m_transferred has left, so is not counted at all (H4).
    ["no_group", ["m_lapsed", "m_new", "m_inactive"]],
    ["needs_review", ["m_lapsed"]],
  ])("filter %s", (filter, expected) => {
    expect(ids(selectMembers(church(), { filter }, NOW))).toEqual(expected);
  });

  it("an unknown filter keeps everyone, archived included", () => {
    expect(selectMembers(church(), { filter: "odd" as MemberFilter }, NOW)).toHaveLength(6);
  });

  it.each([
    ["reference", "mem-0003", ["m_new"]],
    ["preferred name", "ceecee", ["m_new"]],
    ["email", "cara@", ["m_new"]],
    ["surname with extra spaces", "  brown  ", ["m_lapsed"]],
    ["nothing", "nobody", []],
    // M1: the shared person search — preferred name with surname, any order.
    ["preferred name and surname", "CeeCee Clark", ["m_new"]],
    ["surname then first name", "clark cara", ["m_new"]],
  ])("searches by %s", (_label, search, expected) => {
    expect(ids(selectMembers(church(), { search }, NOW))).toEqual(expected);
  });

  it("filters by group, service type and membership date range", () => {
    expect(ids(selectMembers(church(), { groupId: "g1" }, NOW))).toEqual(["m_active"]);
    expect(ids(selectMembers(church(), { preferredServiceType: "midweek_service" }, NOW))).toEqual(["m_new"]);
    expect(ids(selectMembers(church(), { membershipFrom: "2025-01-01" }, NOW))).toEqual(["m_lapsed", "m_new"]);
    expect(
      ids(selectMembers(church(), { membershipFrom: "2025-01-01", membershipTo: "2025-12-31" }, NOW)),
    ).toEqual(["m_lapsed"]);
    expect(ids(selectMembers(church(), { membershipTo: "2024-12-31", filter: "active" }, NOW))).toEqual([
      "m_active",
    ]);
  });
});

describe("membershipBreakdown", () => {
  it("counts each status in a fixed order", () => {
    expect(membershipBreakdown(church())).toEqual([
      { status: "active", label: "Active", count: 2 },
      { status: "new_member", label: "New member", count: 1 },
      { status: "inactive", label: "Inactive", count: 1 },
      { status: "transferred", label: "Transferred", count: 1 },
      { status: "archived", label: "Archived", count: 1 },
    ]);
  });

  it("reports zeros for an empty church", () => {
    expect(membershipBreakdown(snapshot()).every((entry) => entry.count === 0)).toBe(true);
  });
});

describe("groupParticipation", () => {
  it("counts current members in at least one active group", () => {
    // Adeyemi is in an active group; Brown, Clark and Davis (inactive group only) are not.
    expect(groupParticipation(church())).toEqual({ numerator: 1, denominator: 4, percentage: 25 });
  });

  it("has no percentage when there are no current members", () => {
    expect(groupParticipation(snapshot())).toEqual({ numerator: 0, denominator: 0, percentage: null });
  });
});

describe("MEMBER_EXPORT_COLUMNS", () => {
  it("exports plain values without emergency contacts", () => {
    const headers = MEMBER_EXPORT_COLUMNS.map((column) => column.header);
    expect(headers.some((header) => /emergency/i.test(header))).toBe(false);

    const row = memberRows(church(), NOW)[0];
    const values = Object.fromEntries(MEMBER_EXPORT_COLUMNS.map((column) => [column.header, column.value(row)]));
    expect(values).toEqual({
      "Member ID": "MEM-0001",
      "First name": "Grace",
      "Last name": "Adeyemi",
      "Preferred name": undefined,
      Status: "Active",
      "Membership date": "2024-03-10",
      Phone: "+44 7700 900222",
      Email: undefined,
      Household: "Adeyemi household",
      Groups: "Riverside Connect Group; Choir",
      "Preferred service": undefined,
      "Preferred contact": "Phone call",
      "Last attendance": "2026-10-11",
    });
  });

  it("has a label for every filter", () => {
    expect(Object.keys(MEMBER_FILTER_LABELS)).toHaveLength(9);
    expect(MEMBER_FILTER_LABELS.needs_review).toBe("Flagged for review");
  });
});
