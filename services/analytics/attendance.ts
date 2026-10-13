import { average } from "@/lib/metrics";
import { formatWeekLabel, recentWeekStarts, toIsoDate, weekStart } from "@/lib/dates";
import type { IsoDate, PersonId, SessionId } from "@/types/common";
import type {
  AttendanceRecord,
  AttendanceSession,
  AttendanceTrendPoint,
  ServiceType,
} from "@/types/attendance";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * Attendance analytics.
 *
 * Every figure is counted from the stored attendance rows. Nothing is
 * cached or pre-aggregated, so the numbers cannot drift from the records.
 *
 * People are classified by what they are now (member or visitor): the demo
 * does not model historical membership state, and the reports say so.
 */

export interface SessionSummary {
  session: AttendanceSession;
  total: number;
  members: number;
  visitors: number;
  firstTimeVisitors: number;
}

function presentRows(snapshot: ChurchSnapshot): AttendanceRecord[] {
  return snapshot.attendance.filter((row) => row.status === "present");
}

export function sessionSummary(
  snapshot: ChurchSnapshot,
  sessionId: SessionId,
): SessionSummary | undefined {
  const session = snapshot.sessions.find((entry) => entry.id === sessionId);
  if (!session) return undefined;
  return summarise(snapshot, session);
}

export function sessionSummaries(snapshot: ChurchSnapshot): SessionSummary[] {
  return [...snapshot.sessions]
    .sort((left, right) => (left.date < right.date ? 1 : -1))
    .map((session) => summarise(snapshot, session));
}

function summarise(snapshot: ChurchSnapshot, session: AttendanceSession): SessionSummary {
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const rows = presentRows(snapshot).filter((row) => row.sessionId === session.id);

  let members = 0;
  let visitors = 0;
  for (const row of rows) {
    const person = peopleById.get(row.personId);
    if (person?.kind === "member") members += 1;
    else visitors += 1;
  }

  return {
    session,
    total: rows.length,
    members,
    visitors,
    firstTimeVisitors: rows.filter((row) => row.firstVisit).length,
  };
}

/** Weekly totals for the trend chart, oldest week first. */
export function attendanceTrend(
  snapshot: ChurchSnapshot,
  now: Date,
  weeks = 10,
  options: { serviceType?: ServiceType } = {},
): AttendanceTrendPoint[] {
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const buckets = new Map<IsoDate, AttendanceTrendPoint>();

  for (const week of recentWeekStarts(now, weeks)) {
    buckets.set(week, {
      weekStart: week,
      label: formatWeekLabel(week),
      total: 0,
      members: 0,
      visitors: 0,
      firstTimeVisitors: 0,
    });
  }

  for (const row of presentRows(snapshot)) {
    const session = sessionsById.get(row.sessionId);
    if (!session) continue;
    if (options.serviceType && session.type !== options.serviceType) continue;

    const bucket = buckets.get(weekStart(session.date));
    if (!bucket) continue;

    const person = peopleById.get(row.personId);
    buckets.set(bucket.weekStart, {
      ...bucket,
      total: bucket.total + 1,
      members: bucket.members + (person?.kind === "member" ? 1 : 0),
      visitors: bucket.visitors + (person?.kind === "member" ? 0 : 1),
      firstTimeVisitors: bucket.firstTimeVisitors + (row.firstVisit ? 1 : 0),
    });
  }

  const points = Array.from(buckets.values());

  // Drop trailing weeks with nothing recorded: the current week is usually
  // still ahead of its service, and a tail of zeroes reads as a collapse in
  // attendance rather than "this has not happened yet".
  let end = points.length;
  while (end > 1 && points[end - 1].total === 0) end -= 1;
  return points.slice(0, end);
}

/**
 * Average weekly attendance over the configured window. Weeks with no
 * recorded session are left out rather than counted as zero.
 */
export function averageWeeklyAttendance(
  snapshot: ChurchSnapshot,
  now: Date,
  weeks = snapshot.settings.engagement.attendanceAverageWeeks,
): { average: number; weeksCounted: number } {
  const trend = attendanceTrend(snapshot, now, weeks).filter((point) => point.total > 0);
  return { average: average(trend.map((point) => point.total)), weeksCounted: trend.length };
}

/** Attendance for one person, newest first, joined to the session. */
export function personAttendance(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): Array<{ record: AttendanceRecord; session?: AttendanceSession }> {
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  return snapshot.attendance
    .filter((row) => row.personId === personId)
    .map((record) => ({ record, session: sessionsById.get(record.sessionId) }))
    .sort((left, right) => {
      const leftDate = left.session?.date ?? "";
      const rightDate = right.session?.date ?? "";
      return leftDate < rightDate ? 1 : -1;
    });
}

export function presentVisitCount(snapshot: ChurchSnapshot, personId: PersonId): number {
  return presentRows(snapshot).filter((row) => row.personId === personId).length;
}

export function lastAttendanceDate(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): IsoDate | undefined {
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const dates = presentRows(snapshot)
    .filter((row) => row.personId === personId)
    .map((row) => sessionsById.get(row.sessionId)?.date)
    .filter((date): date is IsoDate => Boolean(date))
    .sort();
  return dates.at(-1);
}

/**
 * Weeks since a person last attended. `undefined` when they have never
 * been recorded, which is different from "absent for a long time".
 */
export function weeksSinceLastAttendance(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  now: Date,
): number | undefined {
  const last = lastAttendanceDate(snapshot, personId);
  if (!last) return undefined;
  const days = Math.floor(
    (new Date(toIsoDate(now)).getTime() - new Date(last).getTime()) / (24 * 60 * 60 * 1000),
  );
  return Math.max(0, Math.floor(days / 7));
}

/** Attendance pattern label for a member profile. */
export function attendanceHabit(
  snapshot: ChurchSnapshot,
  person: Person,
  now: Date,
): { label: string; detail: string } {
  const weeks = snapshot.settings.engagement.attendanceAverageWeeks;
  const since = weeksSinceLastAttendance(snapshot, person.id, now);
  const recent = attendanceTrend(snapshot, now, weeks).filter((point) =>
    point.total > 0,
  ).length;

  const attended = recentAttendanceCount(snapshot, person.id, now, weeks);

  if (since === undefined) {
    return { label: "No attendance recorded", detail: "Nothing has been recorded for this person yet." };
  }
  if (since >= snapshot.settings.engagement.inactiveAfterWeeksAbsent) {
    return {
      label: "Not seen recently",
      detail: `Last recorded ${since} weeks ago; the church's threshold for review is ${snapshot.settings.engagement.inactiveAfterWeeksAbsent} weeks.`,
    };
  }
  return {
    label: `${attended} of the last ${recent} weeks`,
    detail: `Counted from recorded attendance over the last ${weeks} weeks.`,
  };
}

export function recentAttendanceCount(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  now: Date,
  weeks: number,
): number {
  const windowWeeks = new Set(recentWeekStarts(now, weeks));
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));

  const attendedWeeks = new Set<IsoDate>();
  for (const row of presentRows(snapshot)) {
    if (row.personId !== personId) continue;
    const session = sessionsById.get(row.sessionId);
    if (!session) continue;
    const week = weekStart(session.date);
    if (windowWeeks.has(week)) attendedWeeks.add(week);
  }
  return attendedWeeks.size;
}
