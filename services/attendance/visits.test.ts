import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { registerVisitor } from "@/services/visitors/registration";
import { attendance, ctx, member, session, snapshot, visitor } from "@/tests/factories";
import type { ChurchSnapshot } from "@/types/snapshot";
import { moveAttendance, recordAttendance, removeAttendance } from "./check-in";
import { importAttendanceCsv } from "./csv-import";
import { firstVisitRecordIds, visitCount, visitSummary } from "./visits";

/**
 * Regression tests for the attendance audit: one definition of a visit, a
 * first visit worked out from the dates, and corrections that undo what a
 * visit set in motion.
 */

const SESSIONS = [
  session({ id: "s_sep27", date: "2026-09-27" }),
  session({ id: "s_oct04", date: "2026-10-04" }),
  session({ id: "s_oct11", date: "2026-10-11" }),
  session({ id: "s_oct25", date: "2026-10-25" }),
];

function visitorFirstOn(date: string, extra: Partial<NonNullable<ReturnType<typeof visitor>["visitor"]>> = {}) {
  return visitor({ visitor: { ...visitor().visitor!, firstVisitDate: date, ...extra } });
}

function church(overrides: Partial<ChurchSnapshot> = {}): ChurchSnapshot {
  return snapshot({ people: [visitorFirstOn("2026-09-27"), member()], sessions: SESSIONS, ...overrides });
}

function firstFlags(data: ChurchSnapshot): Record<string, boolean> {
  return Object.fromEntries(data.attendance.map((row) => [row.sessionId, row.firstVisit]));
}

describe("visit counting", () => {
  it("counts the registered visit when nobody checked them in that day", () => {
    const data = church({ people: [visitorFirstOn("2026-10-04")] });
    expect(visitCount(data, "person_visitor")).toBe(1);
    const withRow = { ...data, attendance: [attendance({ sessionId: "s_oct04" })] };
    expect(visitCount(withRow, "person_visitor")).toBe(1);
  });

  it("counts one earlier, undated visit for somebody who had been before", () => {
    const data = church({ people: [visitorFirstOn("2026-10-04", { returningVisitor: true })] });
    expect(visitSummary(data, "person_visitor")).toMatchObject({ count: 2, firstVisitDate: "2026-10-04" });
  });

  it("ignores visits after the given day", () => {
    const data = church({ attendance: [attendance({ sessionId: "s_oct25" })] });
    expect(visitCount(data, "person_visitor", { until: "2026-10-12" })).toBe(1);
  });

  it("never counts a member as first-time", () => {
    const data = church({ attendance: [attendance({ id: "m1", personId: "person_member", sessionId: "s_oct04" })] });
    expect(firstVisitRecordIds(data).size).toBe(0);
  });
});

describe("first visit after corrections (H1)", () => {
  it("keeps exactly one first visit after undo, a later check-in and a restore", () => {
    const context = ctx();
    let data = church({ attendance: [attendance({ id: "a_sep", sessionId: "s_sep27" })] });
    data = unwrap(removeAttendance(data, "a_sep", "Undone", context)).snapshot;
    data = unwrap(recordAttendance(data, { sessionId: "s_oct11", personId: "person_visitor" }, context)).snapshot;
    data = unwrap(recordAttendance(data, { sessionId: "s_sep27", personId: "person_visitor" }, context)).snapshot;

    expect(firstFlags(data)).toEqual({ s_sep27: true, s_oct11: false });
    expect(firstVisitRecordIds(data).size).toBe(1);
  });

  it("moves the first visit to a backfilled earlier service", () => {
    const context = ctx();
    let data = church({
      people: [visitorFirstOn("2026-10-11")],
      attendance: [attendance({ id: "a_oct11", sessionId: "s_oct11" })],
    });
    data = unwrap(recordAttendance(data, { sessionId: "s_oct04", personId: "person_visitor" }, context)).snapshot;
    expect(firstFlags(data)).toEqual({ s_oct11: false, s_oct04: true });
  });
});

describe("return visits (H2, M3)", () => {
  it("treats a check-in after a registration without a service as visit 2", () => {
    const context = ctx();
    const data = church({ people: [visitorFirstOn("2026-10-04")] });
    const recorded = unwrap(recordAttendance(data, { sessionId: "s_oct11", personId: "person_visitor" }, context));

    expect(recorded.events).toEqual([
      { type: "visitor.returned", personId: "person_visitor", sessionId: "s_oct11", visitCount: 2 },
    ]);
    expect(recorded.snapshot.attendance[0].firstVisit).toBe(false);
    const automated = runAutomations(recorded.snapshot, recorded.events, context);
    expect(automated.snapshot.people[0].visitor?.stageId).toBe("returned");
  });

  it("does not report a return when the check-in is the registered visit itself", () => {
    const data = church({ people: [visitorFirstOn("2026-10-11")] });
    const recorded = unwrap(recordAttendance(data, { sessionId: "s_oct11", personId: "person_visitor" }, ctx()));
    expect(recorded.events).toEqual([]);
    expect(recorded.snapshot.attendance[0].firstVisit).toBe(true);
  });
});

describe("check-in dates (M5, H6)", () => {
  it("refuses a check-in to a service that hasn't happened yet, and allows today", () => {
    const outcome = recordAttendance(church(), { sessionId: "s_oct25", personId: "person_visitor" }, ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });

    const today = church({ sessions: [...SESSIONS, session({ id: "s_today", date: "2026-10-12" })] });
    expect(recordAttendance(today, { sessionId: "s_today", personId: "person_visitor" }, ctx()).ok).toBe(true);
  });

  it("refuses to move a check-in onto a future service", () => {
    const data = church({ attendance: [attendance({ id: "a1", sessionId: "s_oct11" })] });
    expect(moveAttendance(data, "a1", "s_oct25", undefined, ctx())).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("undoing a return visit (M1)", () => {
  it("moves the visitor back to their previous stage and cancels the check-in follow-up", () => {
    const context = ctx();
    const data = church({
      people: [visitorFirstOn("2026-09-27", { stageId: "contact_attempted", contactAttempts: 1 })],
      attendance: [attendance({ id: "a_sep", sessionId: "s_sep27" })],
    });
    const recorded = unwrap(recordAttendance(data, { sessionId: "s_oct11", personId: "person_visitor" }, context));
    const returned = runAutomations(recorded.snapshot, recorded.events, context).snapshot;
    expect(returned.people[0].visitor?.stageId).toBe("returned");
    const followUp = returned.tasks.find((task) => task.automationKey?.startsWith("return_visit_review:"));
    expect(followUp?.status).toBe("pending");

    const newRow = returned.attendance.find((row) => row.sessionId === "s_oct11")!;
    const undone = unwrap(removeAttendance(returned, newRow.id, "Undone at check-in", context));

    expect(undone.snapshot.people[0].visitor?.stageId).toBe("contact_attempted");
    const cancelled = undone.snapshot.tasks.find((task) => task.id === followUp?.id);
    expect(cancelled?.status).toBe("cancelled");
    const stageName = undone.snapshot.settings.pipelineStages.find((stage) => stage.id === "contact_attempted")?.name;
    expect(undone.notices).toContain(`Tunde Balogun moved back to ${stageName}.`);

    // Checking them in again starts a fresh follow-up rather than being blocked by the old key.
    const again = unwrap(recordAttendance(undone.snapshot, { sessionId: "s_oct11", personId: "person_visitor" }, context));
    const reAutomated = runAutomations(again.snapshot, again.events, context).snapshot;
    expect(reAutomated.tasks.filter((task) => task.status === "pending")).toHaveLength(1);
  });
});

describe("moving onto a service where the person was taken off (H4)", () => {
  it("restores that row and takes the source off, instead of inserting a duplicate", () => {
    const data = church({
      attendance: [
        attendance({ id: "a_sep", sessionId: "s_sep27", status: "removed" }),
        attendance({ id: "a_oct", sessionId: "s_oct11" }),
      ],
    });
    const moved = unwrap(moveAttendance(data, "a_oct", "s_sep27", "Wrong day", ctx())).snapshot;

    expect(moved.attendance).toHaveLength(2);
    expect(moved.attendance.find((row) => row.id === "a_sep")).toMatchObject({ status: "present", sessionId: "s_sep27" });
    expect(moved.attendance.find((row) => row.id === "a_oct")).toMatchObject({ status: "removed", sessionId: "s_oct11" });
    const pairs = moved.attendance.map((row) => `${row.sessionId}:${row.personId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("importing a list (H3, M9)", () => {
  it("returns the return-visit events so the automations run", () => {
    const data = church({ attendance: [attendance({ id: "a_sep", sessionId: "s_sep27" })] });
    const imported = unwrap(importAttendanceCsv(data, "s_oct11", "name\nTunde Balogun", ctx()));
    expect(imported.events).toEqual([
      { type: "visitor.returned", personId: "person_visitor", sessionId: "s_oct11", visitCount: 2 },
    ]);
  });

  it("explains a file without a name column", () => {
    const outcome = importAttendanceCsv(church(), "s_oct11", "fullname,tel\nTunde Balogun,0700", ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });
    if (!outcome.ok) expect(outcome.error).toContain("No name column found");
  });

  it("reads a semicolon-separated file", () => {
    const imported = unwrap(importAttendanceCsv(church(), "s_oct11", "name;phone\nTunde Balogun;\nNobody Known;", ctx()));
    expect(imported.summary).toMatchObject({ matched: 1, unmatched: ["Nobody Known"] });
  });

  it("refuses to import into a service that hasn't happened yet", () => {
    expect(importAttendanceCsv(church(), "s_oct25", "name\nTunde Balogun", ctx())).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("registering a visitor at a service (H5)", () => {
  const base = {
    firstName: "Ada",
    lastName: "Eze",
    source: "invitation" as const,
    preferredMethod: "whatsapp" as const,
    permissionGranted: true,
  };

  it("takes the first visit date from the service, not the form", () => {
    const outcome = unwrap(
      registerVisitor(church({ people: [] }), { ...base, visitDate: "2026-10-12", sessionId: "s_sep27" }, ctx()),
    );
    expect(outcome.snapshot.people[0].visitor?.firstVisitDate).toBe("2026-09-27");
    expect(outcome.events[0]).toMatchObject({ type: "visitor.registered", firstVisitDate: "2026-09-27" });
  });

  it("refuses a visit in the future", () => {
    expect(
      registerVisitor(church({ people: [] }), { ...base, visitDate: "2026-10-12", sessionId: "s_oct25" }, ctx()),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(registerVisitor(church({ people: [] }), { ...base, visitDate: "2026-11-01" }, ctx())).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("keeps 'they've been before' and treats them as returning", () => {
    const context = ctx();
    const outcome = unwrap(
      registerVisitor(
        church({ people: [] }),
        { ...base, visitDate: "2026-10-11", sessionId: "s_oct11", returningVisitor: true },
        context,
      ),
    );
    const person = outcome.snapshot.people[0];
    expect(person.visitor?.returningVisitor).toBe(true);
    expect(outcome.events).toContainEqual({
      type: "visitor.returned",
      personId: person.id,
      sessionId: "s_oct11",
      visitCount: 2,
    });
    expect(firstVisitRecordIds(outcome.snapshot).size).toBe(0);
    const automated = runAutomations(outcome.snapshot, outcome.events, context).snapshot;
    expect(automated.people[0].visitor?.stageId).toBe("returned");
  });
});
