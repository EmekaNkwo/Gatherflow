import { addDaysIso } from "@/lib/dates";
import type { AttendanceRecord, AttendanceSession } from "@/types/attendance";
import type { Person } from "@/types/person";
import { at, type SeedContext } from "./context";
import type { AttendancePattern, VisitorPlan } from "./people";
import { TEAM_IDS } from "./team";

/** Weeks of history generated. Ten weeks gives trends without bloating storage. */
export const HISTORY_WEEKS = 10;

const PATTERN_PROBABILITY: Record<AttendancePattern, number> = {
  weekly: 0.86,
  fortnightly: 0.5,
  monthly: 0.26,
  lapsed: 0,
};

export interface SeededAttendance {
  sessions: AttendanceSession[];
  attendance: AttendanceRecord[];
}

/**
 * Builds real attendance records for the last ten weeks. Every attendance
 * figure in the application is counted from these rows — nothing is stored
 * as a pre-computed total.
 */
export function createAttendance(
  ctx: SeedContext,
  people: readonly Person[],
  patterns: Map<string, AttendancePattern>,
  visitorPlans: readonly VisitorPlan[],
): SeededAttendance {
  const sessions: AttendanceSession[] = [];
  const attendance: AttendanceRecord[] = [];

  // A record counts as a first visit only on the person's own recorded first
  // visit date. Long-standing members first attended years before this
  // generated history, so they never count as first-time visitors.
  const firstVisitDates = new Map<string, string>();
  for (const person of people) {
    if (person.visitor) {
      firstVisitDates.set(person.id, person.visitor.firstVisitDate);
    }
  }
  const isFirstVisit = (personId: string, date: string) =>
    firstVisitDates.get(personId) === date;

  const visitsByDate = new Map<string, string[]>();
  for (const plan of visitorPlans) {
    for (const date of plan.visitDates) {
      visitsByDate.set(date, [...(visitsByDate.get(date) ?? []), plan.personId]);
    }
  }

  const sundayThisWeek = addDaysIso(ctx.thisWeek, 6);
  const latestSunday = sundayThisWeek > ctx.today ? addDaysIso(sundayThisWeek, -7) : sundayThisWeek;

  for (let weeksAgo = HISTORY_WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    const sunday = addDaysIso(latestSunday, -7 * weeksAgo);
    const wednesday = addDaysIso(sunday, -4);

    const sundaySession: AttendanceSession = {
      id: ctx.id("session"),
      name: "Sunday service",
      date: sunday,
      startTime: "10:00",
      type: "sunday_service",
      createdAt: at(sunday, 8),
    };
    sessions.push(sundaySession);

    for (const person of people) {
      const pattern = patterns.get(person.id) ?? "lapsed";
      if (ctx.random() < PATTERN_PROBABILITY[pattern]) {
        attendance.push(
          record(
            ctx,
            sundaySession,
            person.id,
            "search",
            at(sunday, 10),
            isFirstVisit(person.id, sunday),
          ),
        );
      }
    }

    for (const personId of visitsByDate.get(sunday) ?? []) {
      if (attendance.some((row) => row.sessionId === sundaySession.id && row.personId === personId)) {
        continue;
      }
      const firstVisit = isFirstVisit(personId, sunday);
      attendance.push(
        record(
          ctx,
          sundaySession,
          personId,
          firstVisit ? "new_visitor" : "search",
          at(sunday, 10),
          firstVisit,
        ),
      );
    }

    // Midweek services run on alternate weeks in the demo history.
    if (weeksAgo % 2 === 0 && wednesday <= ctx.today) {
      const midweekSession: AttendanceSession = {
        id: ctx.id("session"),
        name: "Midweek service",
        date: wednesday,
        startTime: "18:30",
        type: "midweek_service",
        createdAt: at(wednesday, 17),
      };
      sessions.push(midweekSession);

      for (const person of people) {
        const pattern = patterns.get(person.id) ?? "lapsed";
        if (pattern === "weekly" && ctx.chance(0.45)) {
          attendance.push(
            record(ctx, midweekSession, person.id, "search", at(wednesday, 18, 30), false),
          );
        }
      }
    }
  }

  // A special event five weeks ago, plus one upcoming session so the
  // calendar and "record attendance" flows have something to point at.
  const eventDate = addDaysIso(latestSunday, -7 * 5 + 6);
  if (eventDate <= ctx.today) {
    const eventSession: AttendanceSession = {
      id: ctx.id("session"),
      name: "Community outreach day",
      date: eventDate,
      startTime: "11:00",
      type: "special_event",
      notes: "Food bank partnership in the Market Quarter.",
      createdAt: at(eventDate, 9),
    };
    sessions.push(eventSession);
    for (const person of people) {
      if ((patterns.get(person.id) ?? "lapsed") !== "lapsed" && ctx.chance(0.3)) {
        attendance.push(
          record(ctx, eventSession, person.id, "manual", at(eventDate, 11), false),
        );
      }
    }
  }

  const nextSunday = addDaysIso(latestSunday, 7);
  sessions.push({
    id: ctx.id("session"),
    name: "Sunday service",
    date: nextSunday,
    startTime: "10:00",
    type: "sunday_service",
    notes: "Upcoming — ready for check-in.",
    createdAt: at(ctx.today, 9),
  });

  return { sessions, attendance };
}

function record(
  ctx: SeedContext,
  session: AttendanceSession,
  personId: string,
  method: AttendanceRecord["method"],
  recordedAt: string,
  firstVisit: boolean,
): AttendanceRecord {
  return {
    id: ctx.id("attendance"),
    sessionId: session.id,
    personId,
    method,
    status: "present",
    recordedAt,
    recordedBy: TEAM_IDS.volunteerAmara,
    firstVisit,
    corrections: [],
  };
}
