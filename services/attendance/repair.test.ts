import { describe, expect, it } from "vitest";
import { attendance, session, snapshot, visitor } from "@/tests/factories";
import type { Person } from "@/types/person";
import { repairVisitRecords } from "./repair";
import { visitCount, visitSummary } from "./visits";

/** Registered on Monday the 12th, at a moment the check-in shares. */
const REGISTERED_AT = "2026-10-12T09:30:00.000Z";

function registeredMonday(overrides: Partial<NonNullable<Person["visitor"]>> = {}): Person {
  const base = visitor();
  return visitor({
    createdAt: REGISTERED_AT,
    visitor: { ...base.visitor!, firstVisitDate: "2026-10-12", ...overrides },
  });
}

describe("repairVisitRecords", () => {
  it("moves the first visit to the service they were welcomed on, saved in the same moment", () => {
    const broken = snapshot({
      people: [registeredMonday()],
      sessions: [session({ id: "sunday", date: "2026-10-11" })],
      attendance: [attendance({ sessionId: "sunday", recordedAt: "2026-10-12T09:30:00.400Z" })],
    });
    // The bug, as it shows: one service attended, yet counted as two visits.
    expect(visitCount(broken, "person_visitor")).toBe(2);

    const { snapshot: repaired, correctedDates } = repairVisitRecords(broken);

    expect(repaired.people[0].visitor?.firstVisitDate).toBe("2026-10-11");
    expect(visitSummary(repaired, "person_visitor")).toMatchObject({ count: 1, firstVisitDate: "2026-10-11" });
    expect(correctedDates).toEqual(["Tunde Balogun: 2026-10-12 → 2026-10-11"]);
  });

  it("leaves a backfilled earlier service alone: the registration day really was another visit", () => {
    const backfilled = snapshot({
      people: [registeredMonday()],
      sessions: [session({ id: "earlier", date: "2026-10-04" })],
      // Recorded days after the registration, for a service before it.
      attendance: [attendance({ sessionId: "earlier", recordedAt: "2026-10-15T18:00:00.000Z" })],
    });

    const { snapshot: repaired, correctedDates } = repairVisitRecords(backfilled);

    expect(correctedDates).toEqual([]);
    expect(repaired.people[0].visitor?.firstVisitDate).toBe("2026-10-12");
    expect(visitCount(repaired, "person_visitor")).toBe(2);
  });

  it("leaves a correct record alone and is safe to run twice", () => {
    const fine = snapshot({
      people: [registeredMonday({ firstVisitDate: "2026-10-11" })],
      sessions: [session({ id: "sunday", date: "2026-10-11" })],
      attendance: [attendance({ sessionId: "sunday", recordedAt: REGISTERED_AT, firstVisit: true })],
    });

    const once = repairVisitRecords(fine);
    expect(once).toMatchObject({ correctedDates: [], correctedFlags: 0 });
    expect(once.snapshot).toBe(fine);

    const broken = snapshot({
      people: [registeredMonday()],
      sessions: [session({ id: "sunday", date: "2026-10-11" })],
      attendance: [attendance({ sessionId: "sunday", recordedAt: REGISTERED_AT })],
    });
    const first = repairVisitRecords(broken).snapshot;
    expect(repairVisitRecords(first)).toMatchObject({ correctedDates: [], correctedFlags: 0 });
  });

  it("recomputes stored first-visit flags left behind by undo, restore and backfill", () => {
    const twoFirsts = snapshot({
      people: [registeredMonday({ firstVisitDate: "2026-10-04" })],
      sessions: [session({ id: "a", date: "2026-10-04" }), session({ id: "b", date: "2026-10-11" })],
      attendance: [
        attendance({ id: "row_a", sessionId: "a", recordedAt: "2026-10-04T10:00:00.000Z", firstVisit: true }),
        attendance({ id: "row_b", sessionId: "b", recordedAt: "2026-10-11T10:00:00.000Z", firstVisit: true }),
      ],
    });

    const { snapshot: repaired, correctedFlags } = repairVisitRecords(twoFirsts);

    expect(correctedFlags).toBe(1);
    expect(repaired.attendance.find((row) => row.id === "row_a")?.firstVisit).toBe(true);
    expect(repaired.attendance.find((row) => row.id === "row_b")?.firstVisit).toBe(false);
  });

  it("does not touch the original snapshot", () => {
    const broken = snapshot({
      people: [registeredMonday()],
      sessions: [session({ id: "sunday", date: "2026-10-11" })],
      attendance: [attendance({ sessionId: "sunday", recordedAt: REGISTERED_AT })],
    });
    const frozen = JSON.stringify(broken);
    repairVisitRecords(broken);
    expect(JSON.stringify(broken)).toBe(frozen);
  });
});
