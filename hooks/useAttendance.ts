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
import { presentRecords } from "@/services/attendance/check-in";
import {
  sessionsByDate,
  upcomingSessions,
  type CreateSessionInput,
} from "@/services/attendance/sessions";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/** Attendance sessions, check-in and the figures counted from them. */
export function useAttendance(options: { serviceType?: ServiceType; weeks?: number } = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { dispatch } = useCommand();
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
    (input: CreateSessionInput) => dispatch("session.create", input),
    [dispatch],
  );

  const checkIn = useCallback(
    (sessionId: SessionId, personId: PersonId, method: CheckInMethod = "search") =>
      dispatch(
        "attendance.record",
        { sessionId, personId, method },
        { undoLabel: "check-in" },
      ),
    [dispatch],
  );

  const correctRemove = useCallback(
    (recordId: string, reason?: string) =>
      dispatch(
        "attendance.remove",
        { recordId, reason },
        { undoLabel: "attendance correction" },
      ),
    [dispatch],
  );

  const moveRecord = useCallback(
    (recordId: string, toSessionId: SessionId, reason?: string) =>
      dispatch(
        "attendance.move",
        { recordId, toSessionId, reason },
        { undoLabel: "moving the attendance record" },
      ),
    [dispatch],
  );

  const importCsv = useCallback(
    (sessionId: SessionId, csv: string) =>
      dispatch("attendance.importCsv", { sessionId, csv }, { undoLabel: "CSV import" }),
    [dispatch],
  );

  const saveNotes = useCallback(
    (sessionId: SessionId, notes: string) =>
      dispatch("session.updateNotes", { sessionId, notes }),
    [dispatch],
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
