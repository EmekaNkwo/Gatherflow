import { average } from "@/lib/metrics";
import { addDaysIso, formatWeekLabel, recentWeekStarts, toIsoDate, weekStart } from "@/lib/dates";
import { firstVisitRecordIds, wasMemberOn } from "../attendance/visits";
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
 * People are classified by what they were on the day of the session: a
 * member counts as a member from their membership date, and as a visitor
 * at anything they attended before it.
 *
 * Weekly figures count **people**, not check-ins: somebody at both the
 * midweek and the Sunday service is one person that week. And only
 * **completed** weeks (Monday to Sunday, all in the past) go into a weekly
 * figure, so the average does not lurch with every tap during this week's
 * check-in. This week so far is reported on its own.
 */

export { wasMemberOn };

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
  return summarise(snapshot, session, firstVisitRecordIds(snapshot));
}

export function sessionSummaries(snapshot: ChurchSnapshot): SessionSummary[] {
  const firsts = firstVisitRecordIds(snapshot);
  return [...snapshot.sessions]
    .sort((left, right) => (left.date < right.date ? 1 : -1))
    .map((session) => summarise(snapshot, session, firsts));
}

function summarise(
  snapshot: ChurchSnapshot,
  session: AttendanceSession,
  firsts: ReadonlySet<string>,
): SessionSummary {
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const rows = presentRows(snapshot).filter((row) => row.sessionId === session.id);

  let members = 0;
  let visitors = 0;
  for (const row of rows) {
    if (wasMemberOn(peopleById.get(row.personId), session.date)) members += 1;
    else visitors += 1;
  }

  return {
    session,
    total: rows.length,
    members,
    visitors,
    firstTimeVisitors: rows.filter((row) => firsts.has(row.id)).length,
  };
}

/**
 * The Mondays of the last `count` completed weeks, oldest first. The
 * current week is never included: it has not finished yet.
 */
export function completedWeekStarts(now: Date, count: number): IsoDate[] {
  return recentWeekStarts(new Date(`${addDaysIso(weekStart(now), -7)}T12:00:00.000Z`), count);
}

interface WeekTally {
  people: Set<PersonId>;
  members: Set<PersonId>;
  firstTime: number;
}

/** Distinct people per week, for the given weeks only. */
function tallyWeeks(
  snapshot: ChurchSnapshot,
  weeks: readonly IsoDate[],
  options: { serviceType?: ServiceType; until?: IsoDate } = {},
): Map<IsoDate, WeekTally> {
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const firsts = firstVisitRecordIds(snapshot);
  // A local tally, filled in place and returned.
  const tallies = new Map<IsoDate, WeekTally>(
    weeks.map((week) => [week, { people: new Set(), members: new Set(), firstTime: 0 }]),
  );

  for (const row of presentRows(snapshot)) {
    const session = sessionsById.get(row.sessionId);
    if (!session) continue;
    if (options.serviceType && session.type !== options.serviceType) continue;
    if (options.until && session.date > options.until) continue;

    const tally = tallies.get(weekStart(session.date));
    if (!tally) continue;

    tally.people.add(row.personId);
    if (wasMemberOn(peopleById.get(row.personId), session.date)) tally.members.add(row.personId);
    if (firsts.has(row.id)) tally.firstTime += 1;
  }
  return tallies;
}

/**
 * Weekly totals for the trend chart, oldest week first: the last `weeks`
 * completed weeks. A week with no service shows as zero. Each total is the
 * number of different people that week; somebody who became a member during
 * the week counts as a member.
 */
export function attendanceTrend(
  snapshot: ChurchSnapshot,
  now: Date,
  weeks = 10,
  options: { serviceType?: ServiceType } = {},
): AttendanceTrendPoint[] {
  const starts = completedWeekStarts(now, weeks);
  const tallies = tallyWeeks(snapshot, starts, options);

  return starts.map((week) => {
    const tally = tallies.get(week);
    const total = tally?.people.size ?? 0;
    const members = tally?.members.size ?? 0;
    return {
      weekStart: week,
      label: formatWeekLabel(week),
      total,
      members,
      visitors: total - members,
      firstTimeVisitors: tally?.firstTime ?? 0,
    };
  });
}

export interface WeeklyAverage {
  /** Average number of different people a week. */
  average: number;
  /** Completed weeks in the window that had anybody recorded. */
  weeksCounted: number;
  /** Different people recorded so far this week (not part of the average). */
  thisWeek: number;
}

/**
 * Average weekly attendance over the configured window of completed weeks.
 * Weeks with nobody recorded are left out rather than counted as zero.
 */
export function averageWeeklyAttendance(
  snapshot: ChurchSnapshot,
  now: Date,
  weeks = snapshot.settings.engagement.attendanceAverageWeeks,
): WeeklyAverage {
  const trend = attendanceTrend(snapshot, now, weeks).filter((point) => point.total > 0);
  const current = weekStart(now);
  const thisWeek = tallyWeeks(snapshot, [current], { until: toIsoDate(now) }).get(current);
  return {
    average: average(trend.map((point) => point.total)),
    weeksCounted: trend.length,
    thisWeek: thisWeek?.people.size ?? 0,
  };
}

/**
 * Attendance for one person, newest first, joined to the session. The
 * `firstVisit` flag is worked out from the dates, not read from storage.
 */
export function personAttendance(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): Array<{ record: AttendanceRecord; session?: AttendanceSession }> {
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const rows = snapshot.attendance.filter((row) => row.personId === personId);
  const firsts = firstVisitRecordIds({ ...snapshot, attendance: rows });
  return rows
    .map((row) => ({
      record: row.firstVisit === firsts.has(row.id) ? row : { ...row, firstVisit: firsts.has(row.id) },
      session: sessionsById.get(row.sessionId),
    }))
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
  // Completed weeks only, the same weeks the person's own count covers.
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
    detail: `Counted from recorded attendance over the last ${weeks} completed weeks.`,
  };
}

export function recentAttendanceCount(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  now: Date,
  weeks: number,
): number {
  const windowWeeks = new Set(completedWeekStarts(now, weeks));
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
