import type { IsoDate, PersonId } from "@/types/common";
import type { AttendanceRecord, AttendanceSession } from "@/types/attendance";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * What counts as a visit, in one place.
 *
 * A visit is a present attendance row, plus the day a visitor was registered
 * when nobody checked them in that day (the welcome page, or "don't check
 * them in"), plus one earlier, undated visit when the visitor told us they
 * had been before. Check-in, the visitor list, the dashboard and the journey
 * report all count with these helpers, so "came back" means the same thing
 * on every screen.
 *
 * Whether a row was somebody's *first* visit is worked out here too, at read
 * time, from the dates of the services — never trusted from when the row
 * happened to be inserted. Backfilling an earlier service, undoing, restoring
 * or moving a check-in therefore can never leave two "first visits" behind.
 */

export interface VisitOptions {
  /** Ignore anything dated after this day (usually today). */
  until?: IsoDate;
}

export interface VisitSummary {
  /** How many visits we know about. */
  count: number;
  /** The earliest dated visit: first attendance or the registered first visit. */
  firstVisitDate?: IsoDate;
  /** Dated visits, oldest first (one entry per service attended). */
  dates: IsoDate[];
}

/** Whether a person was a member on a given day. */
export function wasMemberOn(person: Person | undefined, date: IsoDate): boolean {
  return (
    person?.kind === "member" &&
    person.member !== undefined &&
    person.member.membershipDate <= date
  );
}

function sessionIndex(snapshot: ChurchSnapshot): Map<string, AttendanceSession> {
  return new Map(snapshot.sessions.map((session) => [session.id, session]));
}

/** Oldest first: by service date, then start time, then when it was recorded. */
function compareVisits(
  left: { row: AttendanceRecord; session: AttendanceSession },
  right: { row: AttendanceRecord; session: AttendanceSession },
): number {
  return (
    left.session.date.localeCompare(right.session.date) ||
    left.session.startTime.localeCompare(right.session.startTime) ||
    left.row.recordedAt.localeCompare(right.row.recordedAt) ||
    left.row.id.localeCompare(right.row.id)
  );
}

function summarise(
  person: Person | undefined,
  attended: readonly IsoDate[],
  options: VisitOptions,
): VisitSummary {
  const within = (date: IsoDate) => !options.until || date <= options.until;
  const dates = attended.filter(within);

  const registered = person?.visitor?.firstVisitDate;
  const registeredVisit =
    registered !== undefined && within(registered) && !dates.includes(registered);
  const allDates = registeredVisit ? [...dates, registered].sort() : dates;
  const earlierUnrecorded = person?.visitor?.returningVisitor ? 1 : 0;

  return {
    count: allDates.length + earlierUnrecorded,
    firstVisitDate: allDates[0],
    dates: allDates,
  };
}

/** Attended service dates per person, oldest first. */
function attendedDatesByPerson(snapshot: ChurchSnapshot): Map<PersonId, IsoDate[]> {
  const sessions = sessionIndex(snapshot);
  // A fresh, local index: built up in place, then handed out sorted.
  const byPerson = new Map<PersonId, IsoDate[]>();
  for (const row of snapshot.attendance) {
    if (row.status !== "present") continue;
    const session = sessions.get(row.sessionId);
    if (!session) continue;
    const dates = byPerson.get(row.personId);
    if (dates) dates.push(session.date);
    else byPerson.set(row.personId, [session.date]);
  }
  return new Map(Array.from(byPerson, ([personId, dates]) => [personId, dates.sort()]));
}

/** Visits for one person. */
export function visitSummary(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  options: VisitOptions = {},
): VisitSummary {
  const sessions = sessionIndex(snapshot);
  const attended = snapshot.attendance
    .filter((row) => row.personId === personId && row.status === "present")
    .map((row) => sessions.get(row.sessionId)?.date)
    .filter((date): date is IsoDate => Boolean(date))
    .sort();
  const person = snapshot.people.find((entry) => entry.id === personId);
  return summarise(person, attended, options);
}

export function visitCount(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  options: VisitOptions = {},
): number {
  return visitSummary(snapshot, personId, options).count;
}

/**
 * Visits for everybody at once, for lists and reports: one pass over the
 * attendance instead of one per person.
 */
export function visitIndex(
  snapshot: ChurchSnapshot,
  options: VisitOptions = {},
): (person: Person) => VisitSummary {
  const attended = attendedDatesByPerson(snapshot);
  return (person) => summarise(person, attended.get(person.id) ?? [], options);
}

/**
 * The attendance rows that were somebody's first visit.
 *
 * A row is a first visit when it is the visitor's earliest attendance, no
 * earlier visit was registered, they did not tell us they had been before,
 * and they were not yet a member that day. Members are never first-time.
 */
export function firstVisitRecordIds(snapshot: ChurchSnapshot): Set<string> {
  const sessions = sessionIndex(snapshot);
  const people = new Map(snapshot.people.map((person) => [person.id, person]));
  const earliest = new Map<PersonId, { row: AttendanceRecord; session: AttendanceSession }>();

  for (const row of snapshot.attendance) {
    if (row.status !== "present") continue;
    const session = sessions.get(row.sessionId);
    if (!session) continue;
    const current = earliest.get(row.personId);
    const candidate = { row, session };
    if (!current || compareVisits(candidate, current) < 0) earliest.set(row.personId, candidate);
  }

  const ids = new Set<string>();
  for (const [personId, { row, session }] of earliest) {
    const visitor = people.get(personId)?.visitor;
    if (!visitor || visitor.returningVisitor) continue;
    if (visitor.firstVisitDate < session.date) continue;
    if (wasMemberOn(people.get(personId), session.date)) continue;
    ids.add(row.id);
  }
  return ids;
}

/**
 * Brings the stored `firstVisit` flag on one person's rows in line with
 * {@link firstVisitRecordIds}. Called after every check-in, undo, restore and
 * move, so screens that read the flag never disagree with the reports.
 */
export function withFirstVisitFlags(snapshot: ChurchSnapshot, personId: PersonId): ChurchSnapshot {
  const firsts = firstVisitRecordIds({
    ...snapshot,
    attendance: snapshot.attendance.filter((row) => row.personId === personId),
  });

  let changed = false;
  const attendance = snapshot.attendance.map((row) => {
    if (row.personId !== personId) return row;
    const firstVisit = firsts.has(row.id);
    if (row.firstVisit === firstVisit) return row;
    changed = true;
    return { ...row, firstVisit };
  });
  return changed ? { ...snapshot, attendance } : snapshot;
}
