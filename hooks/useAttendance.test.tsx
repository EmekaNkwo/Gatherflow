import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCommands,
  freezeTime,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  seedSnapshot,
  toastMock,
} from "@/tests/hooks-harness";
import { useAttendance, usePersonAttendance, useSession } from "./useAttendance";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

beforeEach(() => freezeTime());
afterEach(resetHarness);

describe("useAttendance data", () => {
  it("lists sessions newest first and only the upcoming ones from today", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useAttendance());

    expect(result.current.sessions).toHaveLength(snapshot.sessions.length);
    const dates = result.current.sessions.map((session) => session.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(result.current.upcoming.map((session) => session.id)).toEqual(["session_17"]);
    expect(result.current.summaries).toHaveLength(snapshot.sessions.length);
  });

  // The current week (from Monday 12 October) has no service yet, so its
  // empty bucket is dropped from the end of the trend.
  it("builds a trend over the requested weeks, without the not-yet-held current week", () => {
    seedChurch();
    const { result } = renderHook(() => useAttendance({ weeks: 4, serviceType: "sunday_service" }));

    // The last four completed weeks: the current week (from 12 Oct) is left out.
    expect(result.current.trend.map((point) => point.weekStart)).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
    ]);
    expect(result.current.trend.some((point) => point.total > 0)).toBe(true);
    expect(result.current.weeklyAverage.weeksCounted).toBeGreaterThan(0);
    expect(result.current.weeklyAverage.average).toBeGreaterThan(0);
  });

  it("defaults to a ten-week window", () => {
    seedChurch();
    const { result } = renderHook(() => useAttendance());
    expect(result.current.trend).toHaveLength(10);
    expect(result.current.trend[0].weekStart).toBe("2026-08-03");
  });
});

describe("useAttendance actions", () => {
  beforeEach(() => {
    seedChurch({ role: "volunteer" });
    acceptCommands({ notices: ["Checked in."] });
  });

  type Hook = ReturnType<typeof useAttendance>;
  const session = { name: "Prayer night", date: "2026-10-15", startTime: "19:00", type: "midweek_service" } as const;
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    ["addSession", (hook) => hook.addSession(session), "session.create", session],
    [
      "checkIn (default method)",
      (hook) => hook.checkIn("session_14", "person_1"),
      "attendance.record",
      { sessionId: "session_14", personId: "person_1", method: "search" },
    ],
    [
      "correctRemove",
      (hook) => hook.correctRemove("attendance_1", "Checked in by mistake"),
      "attendance.remove",
      { recordId: "attendance_1", reason: "Checked in by mistake" },
    ],
    [
      "moveRecord",
      (hook) => hook.moveRecord("attendance_1", "session_13", "Wrong week"),
      "attendance.move",
      { recordId: "attendance_1", toSessionId: "session_13", reason: "Wrong week" },
    ],
    [
      "importCsv",
      (hook) => hook.importCsv("session_14", "name\nStephen Achebe"),
      "attendance.importCsv",
      { sessionId: "session_14", csv: "name\nStephen Achebe" },
    ],
    [
      "saveNotes",
      (hook) => hook.saveNotes("session_14", "Harvest Sunday"),
      "session.updateNotes",
      { sessionId: "session_14", notes: "Harvest Sunday" },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => useAttendance());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true });
    expect(toastMock.success).toHaveBeenCalledWith("Checked in.", { description: undefined });
  });

  it("passes an explicit check-in method through", async () => {
    const { result } = renderHook(() => useAttendance());
    await invoke(() => result.current.checkIn("session_14", "person_1", "qr" as never));
    expect(lastCommand().input).toEqual({ sessionId: "session_14", personId: "person_1", method: "qr" });
  });

  it("surfaces a duplicate check-in refusal", async () => {
    refuseCommands("Stephen Achebe is already checked in.", "duplicate");
    const { result } = renderHook(() => useAttendance());

    const outcome = await invoke(() => result.current.checkIn("session_14", "person_1"));

    expect(outcome).toMatchObject({ ok: false, code: "duplicate" });
    expect(toastMock.error).toHaveBeenCalledWith("Stephen Achebe is already checked in.");
  });
});

describe("useSession", () => {
  it("splits people into present, removed and not present, sorted by surname", () => {
    const snapshot = seedSnapshot();
    const present = snapshot.attendance.filter(
      (row) => row.sessionId === "session_14" && row.status === "present",
    );
    // Mark one record as removed so the correction list has something in it.
    const removedRecord = present[0];
    snapshot.attendance = snapshot.attendance.map((row) =>
      row.id === removedRecord.id ? { ...row, status: "removed" } : row,
    );
    seedChurch({ snapshot });

    const { result } = renderHook(() => useSession("session_14"));

    expect(result.current.session?.id).toBe("session_14");
    expect(result.current.present).toHaveLength(present.length - 1);
    const surnames = result.current.present.map((entry) => entry.person?.lastName ?? "");
    expect(surnames).toEqual([...surnames].sort((left, right) => left.localeCompare(right)));
    expect(result.current.removed.map((entry) => entry.record.id)).toEqual([removedRecord.id]);
    expect(result.current.removed[0].person?.id).toBe(removedRecord.personId);
    expect(result.current.notPresent).toHaveLength(snapshot.people.length - (present.length - 1));
  });

  it("has no session for an unknown id", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useSession("session_missing"));

    expect(result.current.summary).toBeUndefined();
    expect(result.current.session).toBeUndefined();
    expect(result.current.present).toEqual([]);
    expect(result.current.notPresent).toHaveLength(snapshot.people.length);
  });
});

describe("usePersonAttendance", () => {
  it("lists one person's attendance, newest session first", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => usePersonAttendance("person_1"));

    expect(result.current).toHaveLength(
      snapshot.attendance.filter((row) => row.personId === "person_1").length,
    );
    const dates = result.current.map((entry) => entry.session?.date ?? "");
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
