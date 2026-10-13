import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { attendance, ctx, member, session, snapshot, visitor } from "@/tests/factories";
import {
  importAttendanceCsv,
  moveAttendance,
  recordAttendance,
  removeAttendance,
  visitCount,
} from "./check-in";
import { createSession } from "./sessions";

const base = () =>
  snapshot({
    people: [visitor(), member()],
    sessions: [session(), session({ id: "session_midweek", name: "Midweek service", date: "2026-10-08" })],
  });

describe("recordAttendance", () => {
  it("records a first visit when nothing else exists for that person", () => {
    const outcome = unwrap(
      recordAttendance(base(), { sessionId: "session_sunday", personId: "person_visitor" }, ctx()),
    );

    expect(outcome.snapshot.attendance).toHaveLength(1);
    expect(outcome.snapshot.attendance[0]).toMatchObject({
      status: "present",
      firstVisit: true,
      recordedBy: TEAM_IDS.coordinator,
    });
  });

  it("refuses a duplicate check-in for the same session", () => {
    const data = snapshot({ ...base(), attendance: [attendance()] });
    const outcome = recordAttendance(
      data,
      { sessionId: "session_sunday", personId: "person_visitor" },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("duplicate");
  });

  it("restores a removed record instead of creating a second row", () => {
    const data = snapshot({
      ...base(),
      attendance: [
        attendance({
          status: "removed",
          corrections: [{ at: "2026-10-11T11:00:00.000Z", by: TEAM_IDS.admin, action: "removed" }],
        }),
      ],
    });

    const outcome = unwrap(
      recordAttendance(data, { sessionId: "session_sunday", personId: "person_visitor" }, ctx()),
    );

    expect(outcome.snapshot.attendance).toHaveLength(1);
    expect(outcome.snapshot.attendance[0].status).toBe("present");
    expect(outcome.snapshot.attendance[0].corrections).toHaveLength(2);
    expect(outcome.snapshot.attendance[0].corrections[1].action).toBe("restored");
  });

  it("reports a return visit so the journey can be reviewed", () => {
    const data = snapshot({ ...base(), attendance: [attendance({ sessionId: "session_midweek" })] });
    const outcome = unwrap(
      recordAttendance(data, { sessionId: "session_sunday", personId: "person_visitor" }, ctx()),
    );

    expect(outcome.events).toEqual([
      {
        type: "visitor.returned",
        personId: "person_visitor",
        sessionId: "session_sunday",
        visitCount: 2,
      },
    ]);
    expect(outcome.snapshot.attendance[1].firstVisit).toBe(false);
  });

  it("does not report a return visit for a member", () => {
    const data = snapshot({
      ...base(),
      attendance: [attendance({ personId: "person_member", sessionId: "session_midweek" })],
    });
    const outcome = unwrap(
      recordAttendance(data, { sessionId: "session_sunday", personId: "person_member" }, ctx()),
    );

    expect(outcome.events).toHaveLength(0);
  });

  it("refuses an unknown session or person", () => {
    expect(
      recordAttendance(base(), { sessionId: "nope", personId: "person_visitor" }, ctx()).ok,
    ).toBe(false);
    expect(
      recordAttendance(base(), { sessionId: "session_sunday", personId: "nope" }, ctx()).ok,
    ).toBe(false);
  });
});

describe("return-visit automation", () => {
  it("moves the visitor to Returned and reviews the next action", () => {
    const context = ctx();
    const data = snapshot({ ...base(), attendance: [attendance({ sessionId: "session_midweek" })] });
    const recorded = unwrap(
      recordAttendance(data, { sessionId: "session_sunday", personId: "person_visitor" }, context),
    );

    const automated = runAutomations(recorded.snapshot, recorded.events, context);
    const person = automated.snapshot.people[0];

    expect(person.visitor?.stageId).toBe("returned");
    expect(automated.snapshot.tasks).toHaveLength(1);
    expect(automated.snapshot.tasks[0].type).toBe("check_in");

    // Replaying must not create a second check-in task.
    const replayed = runAutomations(automated.snapshot, recorded.events, context);
    expect(replayed.snapshot.tasks).toHaveLength(1);
  });

  it("does not create work when the visitor already has an open task", () => {
    const context = ctx();
    const data = snapshot({
      ...base(),
      attendance: [attendance({ sessionId: "session_midweek" })],
    });
    const recorded = unwrap(
      recordAttendance(data, { sessionId: "session_sunday", personId: "person_visitor" }, context),
    );
    const withOpenTask = {
      ...recorded.snapshot,
      tasks: [
        {
          id: "task_existing",
          reference: "FU-0099",
          personId: "person_visitor",
          type: "check_in" as const,
          priority: "normal" as const,
          dueDate: "2026-10-14",
          status: "pending" as const,
          origin: "manual" as const,
          rescheduleHistory: [],
          createdAt: "2026-10-11T09:00:00.000Z",
          createdBy: TEAM_IDS.coordinator,
        },
      ],
    };

    const automated = runAutomations(withOpenTask, recorded.events, context);
    expect(automated.snapshot.tasks).toHaveLength(1);
  });
});

describe("corrections", () => {
  it("removes a record but keeps it for the audit trail", () => {
    const data = snapshot({ ...base(), attendance: [attendance()] });
    const outcome = unwrap(
      removeAttendance(data, "attendance_fixture", "Checked in by mistake", ctx()),
    );

    expect(outcome.snapshot.attendance).toHaveLength(1);
    expect(outcome.snapshot.attendance[0].status).toBe("removed");
    expect(outcome.snapshot.attendance[0].corrections[0]).toMatchObject({
      action: "removed",
      reason: "Checked in by mistake",
    });
    expect(visitCount(outcome.snapshot, "person_visitor")).toBe(0);
  });

  it("moves a record to the right session", () => {
    const data = snapshot({ ...base(), attendance: [attendance()] });
    const outcome = unwrap(
      moveAttendance(data, "attendance_fixture", "session_midweek", "Wrong day", ctx()),
    );

    expect(outcome.snapshot.attendance[0].sessionId).toBe("session_midweek");
    expect(outcome.snapshot.attendance[0].corrections[0]).toMatchObject({
      action: "moved_session",
      previousSessionId: "session_sunday",
    });
  });

  it("refuses to move into a session where the person is already present", () => {
    const data = snapshot({
      ...base(),
      attendance: [
        attendance(),
        attendance({ id: "attendance_2", sessionId: "session_midweek" }),
      ],
    });

    const outcome = moveAttendance(data, "attendance_fixture", "session_midweek", undefined, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("duplicate");
  });
});

describe("createSession", () => {
  it("refuses a session with the same name on the same day", () => {
    const outcome = createSession(
      base(),
      { name: "Sunday service", date: "2026-10-11", startTime: "10:00", type: "sunday_service" },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("duplicate");
  });

  it("creates a session that attendance can be recorded against", () => {
    const outcome = unwrap(
      createSession(
        base(),
        { name: "Prayer meeting", date: "2026-10-16", startTime: "19:00", type: "prayer_meeting" },
        ctx(),
      ),
    );

    expect(outcome.snapshot.sessions).toHaveLength(3);
  });
});

describe("CSV import", () => {
  it("matches people by name or phone and reports the rest", () => {
    const csv = [
      "name,phone",
      "Tunde Balogun,",
      ",+44 7700 900222",
      "Nobody Here,+44 7700 900777",
    ].join("\n");

    const outcome = unwrap(importAttendanceCsv(base(), "session_sunday", csv, ctx()));

    expect(outcome.summary.matched).toBe(2);
    expect(outcome.summary.unmatched).toEqual(["Nobody Here"]);
    expect(outcome.snapshot.attendance).toHaveLength(2);
    expect(outcome.snapshot.attendance[0].method).toBe("csv_import");
  });

  it("counts people who are already checked in as duplicates, not new rows", () => {
    const data = snapshot({ ...base(), attendance: [attendance()] });
    const outcome = unwrap(
      importAttendanceCsv(data, "session_sunday", "name\nTunde Balogun", ctx()),
    );

    expect(outcome.summary.matched).toBe(0);
    expect(outcome.summary.duplicates).toEqual(["Tunde Balogun"]);
  });

  it("refuses an empty file", () => {
    expect(importAttendanceCsv(base(), "session_sunday", "", ctx()).ok).toBe(false);
  });
});
