import { displayName } from "@/lib/strings";
import type { ChurchSnapshot } from "@/types/snapshot";
import { withFirstVisitFlags } from "./visits";

/**
 * Repairs visit records saved before first visits were worked out properly.
 *
 * Two things were stored wrongly, and only these two are changed:
 *
 * 1. Welcoming somebody on an earlier service stored today as their first
 *    visit, not the service's date. The record shows the pattern exactly: a
 *    present check-in saved in the same moment as the registration, on a
 *    service dated before the stored first visit. Left alone, the stored day
 *    also counts as a visit of its own, so the person looks as though they
 *    came back when they did not. The first visit becomes the service date.
 *
 *    A check-in recorded later for an earlier service — a backfill — is a
 *    genuine earlier visit and is not touched: there the registration day
 *    really was a second visit.
 *
 * 2. The stored "first visit" flag on attendance rows, which was set once at
 *    check-in and never revisited. It is recomputed for everybody.
 *
 * Pure and idempotent: running it on a repaired church changes nothing.
 */

/** How close a check-in must be to the registration to have been saved with it. */
const SAME_SAVE_MS = 60_000;

export interface VisitRepair {
  snapshot: ChurchSnapshot;
  /** People whose first visit date was corrected, as "Name: from → to". */
  correctedDates: string[];
  /** How many attendance rows had their first-visit flag corrected. */
  correctedFlags: number;
}

export function repairVisitRecords(snapshot: ChurchSnapshot): VisitRepair {
  const sessionDates = new Map(snapshot.sessions.map((session) => [session.id, session.date]));
  const correctedDates: string[] = [];

  const people = snapshot.people.map((person) => {
    const visitor = person.visitor;
    if (!visitor) return person;
    const registeredAt = Date.parse(person.createdAt);

    const savedWithRegistration = snapshot.attendance
      .filter(
        (row) =>
          row.personId === person.id &&
          row.status === "present" &&
          Math.abs(Date.parse(row.recordedAt) - registeredAt) <= SAME_SAVE_MS,
      )
      .map((row) => sessionDates.get(row.sessionId))
      .filter((date): date is string => Boolean(date))
      .sort();

    const serviceDate = savedWithRegistration[0];
    if (!serviceDate || serviceDate >= visitor.firstVisitDate) return person;

    correctedDates.push(`${displayName(person)}: ${visitor.firstVisitDate} → ${serviceDate}`);
    return { ...person, visitor: { ...visitor, firstVisitDate: serviceDate } };
  });

  const withDates = correctedDates.length ? { ...snapshot, people } : snapshot;
  const everyone = [...new Set(withDates.attendance.map((row) => row.personId))];
  const repaired = everyone.reduce((current, personId) => withFirstVisitFlags(current, personId), withDates);

  const before = new Map(snapshot.attendance.map((row) => [row.id, row.firstVisit]));
  const correctedFlags = repaired.attendance.filter((row) => before.get(row.id) !== row.firstVisit).length;

  return { snapshot: repaired, correctedDates, correctedFlags };
}
