import { describe, expect, it } from "vitest";
import { firstVisitRecordIds } from "@/services/attendance/visits";
import { createSeedSnapshot } from "./index";

const NOW = new Date("2026-10-12T09:00:00.000Z");

describe("seed data", () => {
  it("is deterministic for the same instant", () => {
    const first = createSeedSnapshot(NOW);
    const second = createSeedSnapshot(NOW);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it("produces a church with members, visitors and history", () => {
    const snapshot = createSeedSnapshot(NOW);

    expect(snapshot.people.filter((person) => person.kind === "member").length).toBeGreaterThan(30);
    expect(snapshot.people.filter((person) => person.kind === "visitor").length).toBeGreaterThan(15);
    expect(snapshot.sessions.length).toBeGreaterThan(10);
    expect(snapshot.attendance.length).toBeGreaterThan(100);
    expect(snapshot.groups.length).toBe(10);
    expect(snapshot.templates.length).toBe(7);
    expect(snapshot.careRecords.length).toBe(5);
  });

  it("always has work due today and genuinely overdue work", () => {
    const snapshot = createSeedSnapshot(NOW);
    const today = "2026-10-12";
    const open = snapshot.tasks.filter((task) =>
      ["pending", "in_progress", "rescheduled"].includes(task.status),
    );

    expect(open.filter((task) => task.dueDate === today).length).toBeGreaterThan(0);
    expect(open.filter((task) => task.dueDate < today).length).toBeGreaterThan(2);
  });

  it("leaves some visitors awaiting assignment and never chases an opt-out", () => {
    const snapshot = createSeedSnapshot(NOW);

    const awaiting = snapshot.people.filter(
      (person) => person.kind === "visitor" && !person.visitor?.assignedTo,
    );
    expect(awaiting.length).toBeGreaterThan(0);

    const optedOut = snapshot.people.filter((person) => person.contact.optedOut);
    expect(optedOut.length).toBeGreaterThan(0);
    for (const person of optedOut) {
      const openTasks = snapshot.tasks.filter(
        (task) =>
          task.personId === person.id &&
          ["pending", "in_progress", "rescheduled"].includes(task.status),
      );
      expect(openTasks).toHaveLength(0);
    }
  });

  it("counts a first visit only on the person's own first visit date", () => {
    const snapshot = createSeedSnapshot(NOW);
    const firstVisits = snapshot.attendance.filter((row) => row.firstVisit);

    for (const row of firstVisits) {
      const person = snapshot.people.find((entry) => entry.id === row.personId);
      const session = snapshot.sessions.find((entry) => entry.id === row.sessionId);
      expect(person?.visitor?.firstVisitDate).toBe(session?.date);
    }
  });

  it("keeps pastoral-care notes restricted", () => {
    const snapshot = createSeedSnapshot(NOW);
    const careActivity = snapshot.activity.filter((event) => event.category === "care");

    expect(careActivity.length).toBeGreaterThan(0);
    for (const event of careActivity) {
      expect(event.visibility).toBe("restricted");
    }
    for (const record of snapshot.careRecords) {
      for (const note of record.notes) {
        expect(note.visibility).toBe("restricted");
      }
    }
  });

  it("never has anybody attending before their own first visit (L5)", () => {
    const snapshot = createSeedSnapshot(NOW);
    const dateOf = new Map(snapshot.sessions.map((session) => [session.id, session.date]));
    const early = snapshot.attendance.filter((row) => {
      const first = snapshot.people.find((person) => person.id === row.personId)?.visitor?.firstVisitDate;
      return first !== undefined && (dateOf.get(row.sessionId) ?? "") < first;
    });
    expect(early).toEqual([]);

    // The stored first-visit flags agree with the ones worked out from the dates.
    const derived = firstVisitRecordIds(snapshot);
    const stored = snapshot.attendance.filter((row) => row.firstVisit).map((row) => row.id);
    expect(new Set(stored)).toEqual(derived);
  });
});
