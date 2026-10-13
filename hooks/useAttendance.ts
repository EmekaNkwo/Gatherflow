"use client";

import { useCallback, useMemo } from "react";
import { toIsoDate } from "@/lib/dates";
import type { PersonId, SessionId } from "@/types/common";
import type { CheckInMethod, ServiceType } from "@/types/attendance";
import {
  attendanceTrend,
  averageWeeklyAttendance,
  personAttendance,
  sessionSummaries,
  sessionSummary,
} from "@/services/analytics/attendance";
import {
  importAttendanceCsv,
  moveAttendance,
  presentRecords,
  recordAttendance,
  removeAttendance,
} from "@/services/attendance/check-in";
import {
  createSession,
  sessionsByDate,
  updateSessionNotes,
  upcomingSessions,
  type CreateSessionInput,
} from "@/services/attendance/sessions";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/** Attendance sessions, check-in and the figures counted from them. */
export function useAttendance(options: { serviceType?: ServiceType; weeks?: number } = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { run } = useCommand();
  const today = toIsoDate(now);

  const sessions = useMemo(() => sessionsByDate(snapshot), [snapshot]);
  const upcoming = useMemo(() => upcomingSessions(snapshot, today), [snapshot, today]);
  const summaries = useMemo(() => sessionSummaries(snapshot), [snapshot]);
  const trend = useMemo(
    () => attendanceTrend(snapshot, now, options.weeks ?? 10, { serviceType: options.serviceType }),
    [snapshot, now, options.weeks, options.serviceType],
  );
  const weeklyAverage = useMemo(() => averageWeeklyAttendance(snapshot, now), [snapshot, now]);

  const addSession = useCallback(
    (input: CreateSessionInput) => run((snap, ctx) => createSession(snap, input, ctx)),
    [run],
  );

  const checkIn = useCallback(
    (sessionId: SessionId, personId: PersonId, method: CheckInMethod = "search") =>
      run((snap, ctx) => recordAttendance(snap, { sessionId, personId, method }, ctx), {
        undoLabel: "check-in",
      }),
    [run],
  );

  const correctRemove = useCallback(
    (recordId: string, reason?: string) =>
      run((snap, ctx) => removeAttendance(snap, recordId, reason, ctx), {
        undoLabel: "attendance correction",
      }),
    [run],
  );

  const moveRecord = useCallback(
    (recordId: string, toSessionId: SessionId, reason?: string) =>
      run((snap, ctx) => moveAttendance(snap, recordId, toSessionId, reason, ctx), {
        undoLabel: "moving the attendance record",
      }),
    [run],
  );

  const importCsv = useCallback(
    (sessionId: SessionId, csv: string) =>
      run((snap, ctx) => importAttendanceCsv(snap, sessionId, csv, ctx), {
        undoLabel: "CSV import",
      }),
    [run],
  );

  const saveNotes = useCallback(
    (sessionId: SessionId, notes: string) =>
      run((snap) => updateSessionNotes(snap, sessionId, notes)),
    [run],
  );

  return {
    sessions,
    upcoming,
    summaries,
    trend,
    weeklyAverage,
    addSession,
    checkIn,
    correctRemove,
    moveRecord,
    importCsv,
    saveNotes,
  };
}

/** One session: who is present, and who could still be checked in. */
export function useSession(sessionId: SessionId) {
  const snapshot = useSnapshot();

  return useMemo(() => {
    const summary = sessionSummary(snapshot, sessionId);
    const records = presentRecords(snapshot, sessionId);
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
    const removed = snapshot.attendance.filter(
      (row) => row.sessionId === sessionId && row.status === "removed",
    );

    return {
      summary,
      session: summary?.session,
      present: records
        .map((record) => ({ record, person: peopleById.get(record.personId) }))
        .sort((left, right) =>
          `${left.person?.lastName ?? ""}`.localeCompare(`${right.person?.lastName ?? ""}`),
        ),
      removed: removed.map((record) => ({ record, person: peopleById.get(record.personId) })),
      notPresent: snapshot.people.filter(
        (person) => !records.some((record) => record.personId === person.id),
      ),
    };
  }, [snapshot, sessionId]);
}

export function usePersonAttendance(personId: PersonId) {
  const snapshot = useSnapshot();
  return useMemo(() => personAttendance(snapshot, personId), [snapshot, personId]);
}
