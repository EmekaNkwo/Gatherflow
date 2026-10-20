import { describe, expect, it } from "vitest";
import { attendance, member, NOW, session, snapshot, visitor } from "@/tests/factories";
import {
  attendanceHabit,
  attendanceTrend,
  lastAttendanceDate,
  personAttendance,
  presentVisitCount,
  recentAttendanceCount,
  averageWeeklyAttendance,
  sessionSummaries,
  sessionSummary,
  wasMemberOn,
} from "./attendance";

/**
 * Sessions across three weeks: Sun 27 Sep, Wed 30 Sep (midweek), Sun 4 Oct
 * and Sun 11 Oct. The member joined on 1 Oct, so 27 and 30 Sep count them as
 * a visitor.
 */
function church() {
  const joinedOctober = member({ member: { ...member().member!, membershipDate: "2026-10-01" } });
  return snapshot({
    people: [visitor(), joinedOctober],
    sessions: [
      session({ id: "s_sep27", date: "2026-09-27" }),
      session({ id: "s_sep30", name: "Midweek service", date: "2026-09-30", type: "midweek_service" }),
      session({ id: "s_oct04", date: "2026-10-04" }),
      session({ id: "s_oct11", date: "2026-10-11" }),
    ],
    attendance: [
      attendance({ id: "a1", sessionId: "s_sep27", personId: "person_member", firstVisit: true }),
      attendance({ id: "a2", sessionId: "s_sep30", personId: "person_member", firstVisit: false }),
      attendance({ id: "a3", sessionId: "s_oct04", personId: "person_visitor", firstVisit: true }),
      attendance({ id: "a4", sessionId: "s_oct04", personId: "person_member", firstVisit: false }),
      attendance({ id: "a5", sessionId: "s_oct11", personId: "person_visitor", firstVisit: false, status: "removed" }),
      attendance({ id: "a6", sessionId: "s_gone", personId: "person_visitor", firstVisit: false }),
    ],
  });
}

describe("wasMemberOn", () => {
  const joined = member({ member: { ...member().member!, membershipDate: "2026-10-01" } });

  it.each([
    ["the day before joining", joined, "2026-09-30", false],
    ["the day of joining", joined, "2026-10-01", true],
    ["a visitor", visitor(), "2026-10-01", false],
    ["nobody", undefined, "2026-10-01", false],
  ])("is correct for %s", (_label, person, date, expected) => {
    expect(wasMemberOn(person, date)).toBe(expected);
  });
});

describe("session summaries", () => {
  it("classifies by membership on the day and lists newest first", () => {
    expect(
      sessionSummaries(church()).map((summary) => [
        summary.session.id,
        summary.total,
        summary.members,
        summary.visitors,
        summary.firstTimeVisitors,
      ]),
    ).toEqual([
      ["s_oct11", 0, 0, 0, 0],
      ["s_oct04", 2, 1, 1, 1],
      ["s_sep30", 1, 0, 1, 0],
      // The member had no visitor record: a member is never first-time.
      ["s_sep27", 1, 0, 1, 0],
    ]);
  });

  it("returns undefined for an unknown session", () => {
    expect(sessionSummary(church(), "nope")).toBeUndefined();
  });
});

describe("attendanceTrend", () => {
  it("filters by service type", () => {
    const trend = attendanceTrend(church(), NOW, 3, { serviceType: "midweek_service" });
    expect(trend.map((point) => [point.weekStart, point.total, point.visitors])).toEqual([
      ["2026-09-21", 0, 0],
      ["2026-09-28", 1, 1],
      ["2026-10-05", 0, 0],
    ]);
  });

  it("ignores sessions outside the window and rows without a session", () => {
    const trend = attendanceTrend(church(), NOW, 2);
    // Week of 28 Sep: the member at the midweek and on Sunday, and the visitor
    // on Sunday — two people, not three check-ins.
    expect(trend.map((point) => [point.weekStart, point.label, point.total])).toEqual([
      ["2026-09-28", "28 Sep", 2],
      ["2026-10-05", "5 Oct", 0],
    ]);
  });

  it("shows every completed week, a week with no service as zero", () => {
    const trend = attendanceTrend(snapshot(), NOW, 4);
    expect(trend.map((point) => [point.weekStart, point.total])).toEqual([
      ["2026-09-14", 0],
      ["2026-09-21", 0],
      ["2026-09-28", 0],
      ["2026-10-05", 0],
    ]);
  });

  it("never includes the current, unfinished week (C1)", () => {
    const data = snapshot({
      people: [visitor()],
      sessions: [session({ id: "s_today", date: "2026-10-12" })],
      attendance: [attendance({ sessionId: "s_today" })],
    });
    expect(attendanceTrend(data, NOW, 2).map((point) => point.weekStart)).toEqual(["2026-09-28", "2026-10-05"]);
    expect(attendanceTrend(data, NOW, 2).every((point) => point.total === 0)).toBe(true);
  });
});

describe("per-person attendance", () => {
  it("lists every row newest first, with rows for a missing session last", () => {
    expect(personAttendance(church(), "person_visitor").map((entry) => [entry.record.id, entry.session?.id])).toEqual([
      ["a5", "s_oct11"],
      ["a3", "s_oct04"],
      ["a6", undefined],
    ]);
  });

  it("counts only present rows and finds the last dated one", () => {
    expect(presentVisitCount(church(), "person_visitor")).toBe(2);
    expect(lastAttendanceDate(church(), "person_visitor")).toBe("2026-10-04");
    expect(presentVisitCount(church(), "nobody")).toBe(0);
    expect(lastAttendanceDate(church(), "nobody")).toBeUndefined();
  });

  it("counts distinct weeks attended inside the window", () => {
    expect(recentAttendanceCount(church(), "person_member", NOW, 6)).toBe(2);
    expect(recentAttendanceCount(church(), "person_member", NOW, 1)).toBe(0);
  });
});

describe("attendanceHabit", () => {
  it("says so when nothing has been recorded", () => {
    expect(attendanceHabit(church(), member({ id: "new" }), NOW)).toEqual({
      label: "No attendance recorded",
      detail: "Nothing has been recorded for this person yet.",
    });
  });

  it("describes regular attendance against the weeks that had a session", () => {
    expect(attendanceHabit(church(), church().people[1], NOW)).toEqual({
      label: "2 of the last 2 weeks",
      detail: "Counted from recorded attendance over the last 6 completed weeks.",
    });
  });

  it("flags someone absent past the church's threshold", () => {
    const data = snapshot({
      people: [member()],
      sessions: [session({ id: "old", date: "2026-08-09" })],
      attendance: [attendance({ sessionId: "old", personId: "person_member" })],
    });
    expect(attendanceHabit(data, data.people[0], NOW)).toEqual({
      label: "Not seen recently",
      detail: "Last recorded 9 weeks ago; the church's threshold for review is 8 weeks.",
    });
  });
});

describe("averageWeeklyAttendance (C1, C2)", () => {
  /** Three completed weeks, then a check-in early in the current week. */
  function weeks() {
    const people = ["a", "b", "c"].map((id) => visitor({ id }));
    return snapshot({
      people,
      sessions: [
        session({ id: "w1_wed", date: "2026-09-23", type: "midweek_service" }),
        session({ id: "w1_sun", date: "2026-09-27" }),
        session({ id: "w2_sun", date: "2026-10-04" }),
        session({ id: "w3_sun", date: "2026-10-11" }),
        session({ id: "now_mon", date: "2026-10-12", type: "prayer_meeting" }),
      ],
      attendance: [
        // Week 1: a and b at both services — 2 people, 4 check-ins.
        attendance({ id: "1", sessionId: "w1_wed", personId: "a" }),
        attendance({ id: "2", sessionId: "w1_wed", personId: "b" }),
        attendance({ id: "3", sessionId: "w1_sun", personId: "a" }),
        attendance({ id: "4", sessionId: "w1_sun", personId: "b" }),
        // Week 2: 2 people.
        attendance({ id: "5", sessionId: "w2_sun", personId: "a" }),
        attendance({ id: "6", sessionId: "w2_sun", personId: "c" }),
        // Week 3: 2 people.
        attendance({ id: "7", sessionId: "w3_sun", personId: "b" }),
        attendance({ id: "8", sessionId: "w3_sun", personId: "c" }),
      ],
    });
  }

  it("averages different people over completed weeks", () => {
    expect(averageWeeklyAttendance(weeks(), NOW, 4)).toEqual({ average: 2, weeksCounted: 3, thisWeek: 0 });
  });

  it("does not move when somebody is checked in early in the week", () => {
    const data = weeks();
    const withMonday = {
      ...data,
      attendance: [...data.attendance, attendance({ id: "9", sessionId: "now_mon", personId: "a" })],
    };
    expect(averageWeeklyAttendance(withMonday, NOW, 4)).toEqual({ average: 2, weeksCounted: 3, thisWeek: 1 });
  });
});
