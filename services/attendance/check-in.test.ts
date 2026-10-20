import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { attendance, ctx, member, session, snapshot, visitor } from "@/tests/factories";
import {
  attendanceForPerson,
  moveAttendance,
  presentRecords,
  recordAttendance,
  removeAttendance,
  visitCount,
} from "./check-in";
import { importAttendanceCsv } from "./csv-import";
import { createSession } from "./sessions";

const base = () =>
  snapshot({
    people: [visitor(), member()],
    sessions: [session(), session({ id: "session_midweek", name: "Midweek service", date: "2026-10-08" })],
  });

describe("recordAttendance", () => {
  it("records a first visit when nothing else exists for that person", () => {
    const firstTimer = visitor({ visitor: { ...visitor().visitor!, firstVisitDate: "2026-10-11" } });
    const data = snapshot({ ...base(), people: [firstTimer, member()] });
    const outcome = unwrap(
      recordAttendance(data, { sessionId: "session_sunday", personId: "person_visitor" }, ctx()),
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
    const firstCameMidweek = visitor({ visitor: { ...visitor().visitor!, firstVisitDate: "2026-10-08" } });
    const data = snapshot({
      ...base(),
      people: [firstCameMidweek, member()],
      attendance: [attendance({ sessionId: "session_midweek" })],
    });
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
    // The registered first visit (4 Oct) still counts; the removed row does not.
    expect(visitCount(outcome.snapshot, "person_visitor")).toBe(1);
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

describe("attendance queries", () => {
  const data = () =>
    snapshot({
      ...base(),
      attendance: [
        attendance({ id: "a_sun", recordedAt: "2026-10-11T10:00:00.000Z" }),
        attendance({ id: "a_mid", sessionId: "session_midweek", recordedAt: "2026-10-08T18:30:00.000Z" }),
        attendance({ id: "a_removed", sessionId: "session_midweek", personId: "person_member", status: "removed" }),
        attendance({ id: "a_member", personId: "person_member" }),
      ],
    });

  it("lists present records for one session only", () => {
    expect(presentRecords(data(), "session_sunday").map((row) => row.id)).toEqual(["a_sun", "a_member"]);
    expect(presentRecords(data(), "session_midweek").map((row) => row.id)).toEqual(["a_mid"]);
    expect(presentRecords(data(), "session_unknown")).toEqual([]);
  });

  it("lists a person's present records, most recent first", () => {
    expect(attendanceForPerson(data(), "person_visitor").map((row) => row.id)).toEqual(["a_sun", "a_mid"]);
    expect(attendanceForPerson(data(), "person_member").map((row) => row.id)).toEqual(["a_member"]);
    expect(visitCount(data(), "person_member")).toBe(1);
  });
});

describe("check-in details", () => {
  it("defaults the method to search and logs a readable summary", () => {
    const outcome = unwrap(recordAttendance(base(), { sessionId: "session_sunday", personId: "person_member" }, ctx()));
    // A member is never a first-time visitor.
    expect(outcome.snapshot.attendance[0]).toMatchObject({ method: "search", firstVisit: false, status: "present" });
    expect(outcome.snapshot.activity[0].summary).toBe("Grace Adeyemi was recorded at Sunday service on 11 Oct 2026.");
    expect(outcome.notices).toEqual(["Grace Adeyemi checked in to Sunday service."]);
  });

  it("refuses to remove a record twice or one that does not exist", () => {
    const data = snapshot({ ...base(), attendance: [attendance({ status: "removed" })] });
    expect(removeAttendance(data, "attendance_fixture", undefined, ctx())).toMatchObject({ ok: false, code: "unchanged" });
    expect(removeAttendance(data, "nope", undefined, ctx())).toMatchObject({ ok: false, code: "not_found" });
  });

  it("describes a removal even when the person and session records are gone", () => {
    const data = snapshot({ attendance: [attendance({ personId: "ghost", sessionId: "gone" })] });
    const outcome = unwrap(removeAttendance(data, "attendance_fixture", undefined, ctx()));
    expect(outcome.snapshot.activity[0].summary).toBe("Attendance for a person at a session was removed.");
  });

  it.each([
    ["an unknown record", "nope", "session_midweek", "not_found"],
    ["an unknown session", "attendance_fixture", "gone", "not_found"],
    ["the same session", "attendance_fixture", "session_sunday", "unchanged"],
  ])("refuses to move %s", (_label, recordId, target, code) => {
    const data = snapshot({ ...base(), attendance: [attendance()] });
    expect(moveAttendance(data, recordId, target, undefined, ctx())).toMatchObject({ ok: false, code });
  });

  it("moves a record whose person was deleted, and revives a removed one", () => {
    const data = snapshot({ ...base(), attendance: [attendance({ personId: "ghost", status: "removed" })] });
    const outcome = unwrap(moveAttendance(data, "attendance_fixture", "session_midweek", undefined, ctx()));
    expect(outcome.snapshot.attendance[0]).toMatchObject({ sessionId: "session_midweek", status: "present" });
    expect(outcome.snapshot.activity[0].summary).toBe("A person was moved to Midweek service on 8 Oct 2026.");
    expect(outcome.notices).toEqual(["Attendance moved."]);
  });
});

describe("CSV import details", () => {
  it("accepts separate first and last name columns and reports counts in words", () => {
    const csv = ["First Name,Last Name,Note", "Tunde,Balogun,", "Grace,Adeyemi,", "Ada,Okafor,", ",,walk-in"].join("\n");
    const outcome = unwrap(importAttendanceCsv(base(), "session_sunday", csv, ctx()));
    expect(outcome.summary).toEqual({
      matched: 2,
      skipped: 0,
      unmatched: ["Ada Okafor", "(blank row)"],
      duplicates: [],
    });
    expect(outcome.notices).toEqual(["2 attendance records imported.", "2 rows did not match anyone."]);
  });

  it("uses the phone as the label of an unmatched nameless row and the singular for one", () => {
    const outcome = unwrap(importAttendanceCsv(base(), "session_sunday", "name,phone\nTunde Balogun,\n,07000 000000", ctx()));
    expect(outcome.summary.unmatched).toEqual(["07000 000000"]);
    expect(outcome.notices).toEqual(["1 attendance record imported.", "1 row did not match anyone."]);
  });

  it("reports duplicates in the notices", () => {
    const data = snapshot({ ...base(), attendance: [attendance()] });
    const outcome = unwrap(importAttendanceCsv(data, "session_sunday", "name\nTunde Balogun\nTunde Balogun", ctx()));
    expect(outcome.summary).toMatchObject({ matched: 0, skipped: 2, duplicates: ["Tunde Balogun", "Tunde Balogun"] });
    expect(outcome.notices).toEqual(["0 attendance records imported.", "2 already checked in."]);
  });

  it("refuses an unknown session", () => {
    expect(importAttendanceCsv(base(), "gone", "name\nTunde Balogun", ctx())).toMatchObject({ ok: false, code: "not_found" });
  });
});
