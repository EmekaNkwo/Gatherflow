import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/result";
import { attendance, ctx, NOW, session, snapshot } from "@/tests/factories";
import {
  createSession,
  deleteSession,
  pastSessions,
  sessionsByDate,
  updateSession,
  updateSessionNotes,
  upcomingSessions,
} from "./sessions";

describe("createSession", () => {
  it("creates a session with trimmed name and notes and logs it", () => {
    const before = snapshot({ sessions: [session()] });
    const outcome = unwrap(
      createSession(
        before,
        { name: "  Harvest service ", date: "2026-10-18", startTime: "11:00", type: "special_event", notes: "  Bring food " },
        ctx(),
      ),
    );

    expect(outcome.snapshot.sessions[1]).toEqual({
      id: "session_1",
      name: "Harvest service",
      date: "2026-10-18",
      startTime: "11:00",
      type: "special_event",
      groupId: undefined,
      notes: "Bring food",
      createdAt: NOW.toISOString(),
    });
    expect(outcome.snapshot.activity[0]).toMatchObject({
      type: "attendance.session_created",
      summary: "Harvest service on 18 Oct 2026 was created.",
      meta: { sessionId: "session_1" },
    });
    expect(outcome.notices).toEqual(["Harvest service created."]);
    expect(before.sessions).toHaveLength(1);
  });

  it("allows the same name on a different day and drops blank notes", () => {
    const outcome = unwrap(
      createSession(
        snapshot({ sessions: [session()] }),
        { name: "Sunday service", date: "2026-10-18", startTime: "10:00", type: "sunday_service", notes: "   ", groupId: "g1" },
        ctx(),
      ),
    );
    expect(outcome.snapshot.sessions[1]).toMatchObject({ notes: undefined, groupId: "g1" });
  });

  it("refuses the same kind of gathering at the same time on the same day, whatever it is called", () => {
    const outcome = createSession(
      snapshot({ sessions: [session()] }),
      { name: "Second service", date: "2026-10-11", startTime: "10:00", type: "sunday_service" },
      ctx(),
    );
    expect(outcome).toEqual({
      ok: false,
      error: 'There is already a sunday service on 11 Oct 2026 at 10:00 ("Sunday service").',
      code: "duplicate",
    });
  });

  it("allows two services with the same name at different times on the same day", () => {
    const outcome = createSession(
      snapshot({ sessions: [session()] }),
      { name: "Sunday service", date: "2026-10-11", startTime: "08:00", type: "sunday_service" },
      ctx(),
    );
    expect(outcome.ok).toBe(true);
  });

  it.each([
    ["1900-01-01", "too far back"],
    ["2030-01-01", "too far ahead"],
  ])("refuses a mistyped year (%s)", (date, words) => {
    const outcome = createSession(snapshot(), { name: "Typo", date, startTime: "10:00", type: "sunday_service" }, ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });
    if (!outcome.ok) expect(outcome.error).toContain(words);
  });

  it("refuses a blank name", () => {
    const outcome = createSession(snapshot(), { name: "  ", date: "2026-10-18", startTime: "10:00", type: "sunday_service" }, ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("updateSessionNotes", () => {
  it.each([
    ["  Communion Sunday ", "Communion Sunday"],
    ["   ", undefined],
  ])("saves %j as %j", (notes, expected) => {
    const before = snapshot({ sessions: [session({ notes: "old" })] });
    const outcome = unwrap(updateSessionNotes(before, "session_sunday", notes));
    expect(outcome.snapshot.sessions[0].notes).toBe(expected);
    expect(outcome.notices).toEqual(["Session notes saved."]);
    expect(before.sessions[0].notes).toBe("old");
  });

  it("refuses an unknown session", () => {
    expect(updateSessionNotes(snapshot(), "nope", "x")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("session ordering", () => {
  const data = snapshot({
    sessions: [
      session({ id: "past", date: "2026-10-04" }),
      session({ id: "today", date: "2026-10-12" }),
      session({ id: "later", date: "2026-10-25" }),
      session({ id: "next", date: "2026-10-18" }),
    ],
  });

  it("orders sessions newest first without reordering the snapshot", () => {
    expect(sessionsByDate(data).map((entry) => entry.id)).toEqual(["later", "next", "today", "past"]);
    expect(data.sessions.map((entry) => entry.id)).toEqual(["past", "today", "later", "next"]);
  });

  it("lists today's and future sessions soonest first", () => {
    expect(upcomingSessions(data, "2026-10-12").map((entry) => entry.id)).toEqual(["today", "next", "later"]);
    expect(upcomingSessions(data, "2026-11-01")).toEqual([]);
  });
});

describe("updateSession", () => {
  const input = { sessionId: "session_sunday", name: "Harvest Sunday", date: "2026-10-04", startTime: "11:00", type: "special_event" as const };

  it("corrects the name, date, time and kind and logs it", () => {
    const before = snapshot({ sessions: [session({ notes: "keep" })] });
    const outcome = unwrap(updateSession(before, input, ctx()));
    expect(outcome.snapshot.sessions[0]).toMatchObject({
      id: "session_sunday",
      name: "Harvest Sunday",
      date: "2026-10-04",
      startTime: "11:00",
      type: "special_event",
      notes: "keep",
    });
    expect(outcome.snapshot.activity[0]).toMatchObject({ type: "attendance.session_updated" });
    expect(before.sessions[0].name).toBe("Sunday service");
  });

  it("refuses an unknown session, a clash with another service and a mistyped year", () => {
    const data = snapshot({ sessions: [session(), session({ id: "other", date: "2026-10-04", startTime: "11:00", type: "special_event" })] });
    expect(updateSession(data, { ...input, sessionId: "nope" }, ctx())).toMatchObject({ ok: false, code: "not_found" });
    expect(updateSession(data, input, ctx())).toMatchObject({ ok: false, code: "duplicate" });
    expect(updateSession(data, { ...input, date: "1900-01-01" }, ctx())).toMatchObject({ ok: false, code: "invalid" });
  });

  it("does not let a service people attended move to a day that hasn't happened yet", () => {
    const data = snapshot({ sessions: [session()], attendance: [attendance()] });
    expect(updateSession(data, { ...input, date: "2026-10-25" }, ctx())).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("deleteSession", () => {
  it("deletes a service nobody is checked in to, with any rows already taken off", () => {
    const data = snapshot({ sessions: [session()], attendance: [attendance({ status: "removed" })] });
    const outcome = unwrap(deleteSession(data, "session_sunday", ctx()));
    expect(outcome.snapshot.sessions).toEqual([]);
    expect(outcome.snapshot.attendance).toEqual([]);
    expect(outcome.snapshot.activity[0]).toMatchObject({ type: "attendance.session_deleted" });
  });

  it("refuses a service with somebody checked in, and an unknown one", () => {
    const data = snapshot({ sessions: [session()], attendance: [attendance()] });
    const outcome = deleteSession(data, "session_sunday", ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });
    if (!outcome.ok) expect(outcome.error).toContain("1 person is checked in");
    expect(deleteSession(data, "nope", ctx())).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("pastSessions", () => {
  it("lists services that have happened in the window, newest first, including empty ones", () => {
    const data = snapshot({
      sessions: [
        session({ id: "old", date: "2026-07-01" }),
        session({ id: "empty", date: "2026-10-09" }),
        session({ id: "sunday", date: "2026-10-11" }),
        session({ id: "future", date: "2026-10-18" }),
      ],
    });
    expect(pastSessions(data, "2026-10-12", 8).map((entry) => entry.id)).toEqual(["sunday", "empty"]);
  });
});
