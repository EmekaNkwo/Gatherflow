import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { toCsv } from "@/lib/csv";
import { attendance, member, NOW, session, snapshot, task, visitor } from "@/tests/factories";
import type { Person } from "@/types/person";
import {
  contactMethodOptions,
  selectVisitors,
  VISITOR_EXPORT_COLUMNS,
  VISITOR_FILTER_LABELS,
  visitorRows,
  visitorsByStage,
  type VisitorFilter,
} from "./selectors";

/** A visitor with the same base profile and a few overrides on the visitor block. */
function visitorWith(id: string, profile: Partial<NonNullable<Person["visitor"]>>, rest: Partial<Person> = {}): Person {
  const base = visitor();
  return visitor({ id, ...rest, visitor: { ...base.visitor!, ...profile } });
}

/**
 * A small directory with one visitor per interesting state:
 * - `v_new`: first visit, unassigned, never contacted
 * - `v_returning`: two visits, assigned and contacted
 * - `v_contacted_once`: one visit, contacted, waiting to return
 * - `v_orientation`: asked about membership
 * - `v_declined`: closed with contact declined
 * - `v_opted_out`: opted out of contact
 * - `v_member`: a visitor who became a member
 */
function directory() {
  const people: Person[] = [
    visitorWith("v_new", { firstVisitDate: "2026-10-11" }, { firstName: "Ada", lastName: "Okafor", phone: "+44 7700 900301", email: "ada@example.com" }),
    visitorWith(
      "v_returning",
      { firstVisitDate: "2026-09-27", assignedTo: TEAM_IDS.volunteerAmara, stageId: "returned", lastContactAt: "2026-09-29T10:00:00.000Z" },
      { firstName: "Bayo", lastName: "Adeleke", preferredName: "Bee", phone: undefined, email: undefined },
    ),
    visitorWith(
      "v_contacted_once",
      { firstVisitDate: "2026-10-04", assignedTo: TEAM_IDS.coordinator, stageId: "contacted", lastContactAt: "2026-10-06T10:00:00.000Z" },
      { firstName: "Chidi", lastName: "Eze" },
    ),
    visitorWith(
      "v_orientation",
      { firstVisitDate: "2026-09-20", stageId: "membership_orientation", membershipInterestAt: "2026-10-01T10:00:00.000Z" },
      { firstName: "Dami", lastName: "Fashola" },
    ),
    visitorWith(
      "v_declined",
      {
        firstVisitDate: "2026-09-13",
        stageId: "closed",
        closure: { reason: "contact_declined", recordedAt: "2026-09-20T10:00:00.000Z" },
      },
      { firstName: "Efe", lastName: "Gbade" },
    ),
    visitorWith(
      "v_opted_out",
      { firstVisitDate: "2026-09-06" },
      { firstName: "Funmi", lastName: "Hassan", contact: { preferredMethod: "email", permissionGranted: false, optedOut: true } },
    ),
    visitorWith(
      "v_member",
      { firstVisitDate: "2026-08-30", stageId: "connected", lastContactAt: "2026-09-01T10:00:00.000Z" },
      { firstName: "Gbenga", lastName: "Idowu", member: member().member },
    ),
    member({ id: "m_plain", firstName: "Hannah", lastName: "Jones" }),
  ];

  return snapshot({
    people,
    sessions: [
      session({ id: "s1", date: "2026-09-27" }),
      session({ id: "s2", date: "2026-10-04" }),
      session({ id: "s3", date: "2026-10-11" }),
    ],
    attendance: [
      attendance({ id: "a1", sessionId: "s3", personId: "v_new" }),
      attendance({ id: "a2", sessionId: "s1", personId: "v_returning" }),
      attendance({ id: "a3", sessionId: "s3", personId: "v_returning", firstVisit: false }),
      attendance({ id: "a4", sessionId: "s2", personId: "v_contacted_once" }),
      attendance({ id: "a5", sessionId: "s2", personId: "v_member", status: "removed" }),
    ],
    tasks: [
      task({ id: "t_overdue", personId: "v_returning", dueDate: "2026-10-10", reference: "FU-0001" }),
      task({ id: "t_later", personId: "v_returning", dueDate: "2026-10-20", reference: "FU-0002" }),
      task({ id: "t_done", personId: "v_new", dueDate: "2026-10-01", status: "completed", reference: "FU-0003" }),
      task({ id: "t_today", personId: "v_contacted_once", dueDate: "2026-10-12", reference: "FU-0004" }),
    ],
  });
}

const ids = (rows: { person: Person }[]) => rows.map((row) => row.person.id);

describe("visitorRows", () => {
  it("lists only people with a visitor profile, newest first visit first", () => {
    const rows = visitorRows(directory(), NOW);
    expect(ids(rows)).toEqual([
      "v_new",
      "v_contacted_once",
      "v_returning",
      "v_orientation",
      "v_declined",
      "v_opted_out",
      "v_member",
    ]);
  });

  it("joins visits, last visit, assignee and the earliest open task", () => {
    const row = visitorRows(directory(), NOW).find((entry) => entry.person.id === "v_returning")!;
    expect(row.visits).toBe(2);
    expect(row.firstVisit).toBe("2026-09-27");
    expect(row.lastVisit).toBe("2026-10-11");
    expect(row.assigneeName).toBe("Amara Nwosu");
    expect(row.openTaskCount).toBe(2);
    expect(row.nextFollowUpDate).toBe("2026-10-10");
    expect(row.nextFollowUp?.id).toBe("t_overdue");
    expect(row.hasOverdue).toBe(true);
    expect(row.statusLabel).toBe("Came back");
    expect(row.preferredContactLabel).toBe("WhatsApp");
  });

  it("ignores completed tasks and removed attendance", () => {
    const rows = visitorRows(directory(), NOW);
    const fresh = rows.find((entry) => entry.person.id === "v_new")!;
    expect(fresh.openTaskCount).toBe(0);
    expect(fresh.nextFollowUp).toBeUndefined();
    expect(fresh.hasOverdue).toBe(false);
    expect(fresh.assigneeName).toBeUndefined();

    const joined = rows.find((entry) => entry.person.id === "v_member")!;
    // The removed row does not count; the registered first visit does.
    expect(joined.visits).toBe(1);
    expect(joined.lastVisit).toBeUndefined();
  });

  it.each([
    ["v_member", "Became a member", undefined],
    ["v_declined", "Contact declined", "Contact declined"],
    ["v_new", "Just visited", undefined],
    ["v_orientation", "Exploring membership", undefined],
  ])("labels %s as %s", (id, label, closedReason) => {
    const row = visitorRows(directory(), NOW).find((entry) => entry.person.id === id)!;
    expect(row.statusLabel).toBe(label);
    expect(row.closedReason).toBe(closedReason);
  });

  it("falls back to 'Unknown stage' for a stage the church has removed", () => {
    const data = snapshot({ people: [visitorWith("v_lost", { stageId: "deleted_stage" })] });
    const [row] = visitorRows(data, NOW);
    expect(row.stage).toBeUndefined();
    expect(row.statusLabel).toBe("Unknown stage");
  });

  it("keeps a renamed stage's own name", () => {
    const base = snapshot({ people: [visitor()] });
    const data = snapshot({
      people: [visitor()],
      settings: {
        ...base.settings,
        pipelineStages: base.settings.pipelineStages.map((stage) =>
          stage.id === "new_visitor" ? { ...stage, name: "Welcome desk" } : stage,
        ),
      },
    });
    expect(visitorRows(data, NOW)[0].statusLabel).toBe("Welcome desk");
  });

  it("returns nothing for an empty directory", () => {
    expect(visitorRows(snapshot(), NOW)).toEqual([]);
  });
});

describe("selectVisitors", () => {
  it.each<[VisitorFilter, string[]]>([
    ["all", ["v_new", "v_contacted_once", "v_returning", "v_orientation", "v_declined", "v_opted_out", "v_member"]],
    ["first_time", ["v_new", "v_contacted_once", "v_orientation", "v_declined", "v_opted_out"]],
    ["returning", ["v_returning"]],
    ["awaiting_assignment", ["v_new", "v_orientation", "v_opted_out"]],
    ["awaiting_contact", ["v_new", "v_orientation", "v_opted_out"]],
    ["contacted", ["v_contacted_once", "v_returning", "v_member"]],
    ["overdue", ["v_returning"]],
    ["awaiting_second_visit", ["v_contacted_once"]],
    ["awaiting_orientation", ["v_orientation"]],
    ["contact_declined", ["v_declined", "v_opted_out"]],
    ["became_member", ["v_member"]],
  ])("filter %s", (filter, expected) => {
    expect(ids(selectVisitors(directory(), { filter }, NOW))).toEqual(expected);
  });

  it("treats an unknown filter value as 'all'", () => {
    const rows = selectVisitors(directory(), { filter: "mystery" as VisitorFilter }, NOW);
    expect(rows).toHaveLength(7);
  });

  it.each([
    ["first name, any case", "  ADA ", ["v_new"]],
    ["preferred name", "bee", ["v_returning"]],
    ["phone fragment", "900301", ["v_new"]],
    ["email", "ada@example", ["v_new"]],
    ["full name across fields", "chidi eze", ["v_contacted_once"]],
    ["no match", "zzz", []],
  ])("searches by %s", (_label, search, expected) => {
    expect(ids(selectVisitors(directory(), { search }, NOW))).toEqual(expected);
  });

  it("filters by stage", () => {
    expect(ids(selectVisitors(directory(), { stageId: "contacted" }, NOW))).toEqual(["v_contacted_once"]);
  });

  it("filters by a named assignee", () => {
    expect(ids(selectVisitors(directory(), { assigneeId: TEAM_IDS.coordinator }, NOW))).toEqual([
      "v_contacted_once",
    ]);
  });

  it("filters to unassigned visitors", () => {
    expect(ids(selectVisitors(directory(), { assigneeId: "unassigned" }, NOW))).toEqual([
      "v_new",
      "v_orientation",
      "v_declined",
      "v_opted_out",
      "v_member",
    ]);
  });

  it("combines search, filter and assignee", () => {
    const rows = selectVisitors(
      directory(),
      { search: "eze", filter: "contacted", assigneeId: TEAM_IDS.volunteerAmara },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("does not modify the snapshot it reads", () => {
    const data = directory();
    const before = JSON.stringify(data);
    selectVisitors(data, { filter: "overdue", search: "bayo" }, NOW);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("visitorsByStage", () => {
  it("returns every stage in configured order with its visitors", () => {
    const columns = visitorsByStage(directory(), NOW);
    expect(columns.map((column) => column.stage.id)).toEqual([
      "new_visitor",
      "contact_pending",
      "contact_attempted",
      "contacted",
      "invited_to_return",
      "returned",
      "membership_orientation",
      "connected",
      "closed",
    ]);
    const byStage = Object.fromEntries(columns.map((column) => [column.stage.id, ids(column.rows)]));
    expect(byStage.new_visitor).toEqual(["v_new", "v_opted_out"]);
    expect(byStage.returned).toEqual(["v_returning"]);
    expect(byStage.closed).toEqual(["v_declined"]);
    expect(byStage.contact_pending).toEqual([]);
  });

  it("ignores a stage filter but honours the other query fields", () => {
    const columns = visitorsByStage(directory(), NOW, { stageId: "closed", search: "ada" });
    const nonEmpty = columns.filter((column) => column.rows.length > 0);
    expect(nonEmpty.map((column) => column.stage.id)).toEqual(["new_visitor"]);
  });

  it("orders stages by their order field, not by array position", () => {
    const base = snapshot();
    const reversed = snapshot({
      settings: { ...base.settings, pipelineStages: [...base.settings.pipelineStages].reverse() },
    });
    expect(visitorsByStage(reversed, NOW)[0].stage.id).toBe("new_visitor");
  });
});

describe("VISITOR_EXPORT_COLUMNS", () => {
  it("exports the agreed columns and nothing private", () => {
    const headers = VISITOR_EXPORT_COLUMNS.map((column) => column.header);
    expect(headers).toEqual([
      "First name",
      "Last name",
      "Preferred name",
      "Phone",
      "Email",
      "First visit",
      "Last visit",
      "Visits",
      "Source",
      "Follow-up status",
      "Assigned to",
      "Next follow-up",
      "Preferred contact",
      "Contact permission",
      "Opted out",
    ]);
    expect(headers.some((header) => /note|emergency|pastoral/i.test(header))).toBe(false);
  });

  it("maps a row to plain values", () => {
    const row = visitorRows(directory(), NOW).find((entry) => entry.person.id === "v_returning")!;
    const values = VISITOR_EXPORT_COLUMNS.map((column) => column.value(row));
    expect(values).toEqual([
      "Bayo",
      "Adeleke",
      "Bee",
      undefined,
      undefined,
      "2026-09-27",
      "2026-10-11",
      2,
      "Friend or family invitation",
      "Came back",
      "Amara Nwosu",
      "2026-10-10",
      "WhatsApp",
      "Yes",
      "No",
    ]);
  });

  it("reports opt-outs and withheld permission", () => {
    const row = visitorRows(directory(), NOW).find((entry) => entry.person.id === "v_opted_out")!;
    const byHeader = Object.fromEntries(VISITOR_EXPORT_COLUMNS.map((column) => [column.header, column.value(row)]));
    expect(byHeader["Contact permission"]).toBe("No");
    expect(byHeader["Opted out"]).toBe("Yes");
  });

  it("serialises through the CSV helper", () => {
    const rows = selectVisitors(directory(), { filter: "returning" }, NOW);
    const csv = toCsv(rows, VISITOR_EXPORT_COLUMNS);
    expect(csv.split(/\r?\n/)[0]).toContain("First name");
    expect(csv).toContain("Adeleke");
  });
});

describe("labels and options", () => {
  it("has a label for every filter", () => {
    expect(Object.keys(VISITOR_FILTER_LABELS)).toHaveLength(13);
    expect(VISITOR_FILTER_LABELS.awaiting_orientation).toBe("Awaiting membership orientation");
  });

  it("lists contact methods with labels", () => {
    expect(contactMethodOptions()).toEqual([
      { value: "phone", label: "Phone call" },
      { value: "sms", label: "SMS" },
      { value: "whatsapp", label: "WhatsApp" },
      { value: "email", label: "Email" },
      { value: "in_person", label: "In person" },
    ]);
  });
});

describe("audit fixes: search and this month's first-timers", () => {
  it("finds people however their name or number is typed", () => {
    const data = snapshot({
      people: [visitor({ firstName: "Émilie", lastName: "O'Brien-Núñez", phone: "+44 7700 111001" })],
    });
    for (const search of ["Emilie", "obrien", "07700 111001", "7700111001"]) {
      expect(selectVisitors(data, { search }, NOW), search).toHaveLength(1);
    }
  });

  it("counts somebody as a first-timer this month only by their first-visit date", () => {
    const data = snapshot({
      people: [
        visitor({ id: "this_month", visitor: { ...visitor().visitor!, firstVisitDate: "2026-10-04" } }),
        visitor({ id: "last_month", visitor: { ...visitor().visitor!, firstVisitDate: "2026-09-27" } }),
      ],
    });
    expect(selectVisitors(data, { filter: "first_time_this_month" }, NOW).map((row) => row.person.id)).toEqual([
      "this_month",
    ]);
  });
});

describe("audit fixes: first-timers this month match the journey report", () => {
  it("leaves out anyone registered as having been before, and counts by their earliest visit", () => {
    const data = snapshot({
      people: [
        visitor({ id: "new", visitor: { ...visitor().visitor!, firstVisitDate: "2026-10-04" } }),
        visitor({ id: "been_before", visitor: { ...visitor().visitor!, firstVisitDate: "2026-10-04", returningVisitor: true } }),
        visitor({ id: "came_in_sept", visitor: { ...visitor().visitor!, firstVisitDate: "2026-10-04" } }),
      ],
      sessions: [session({ id: "sept", date: "2026-09-27" })],
      attendance: [attendance({ id: "a_sept", sessionId: "sept", personId: "came_in_sept" })],
    });
    expect(selectVisitors(data, { filter: "first_time_this_month" }, NOW).map((row) => row.person.id)).toEqual(["new"]);
  });
});
