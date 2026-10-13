import { formatDisplayDate } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import { displayName, normalisePhone, normalise } from "@/lib/strings";
import { parseCsvRecords } from "@/lib/csv";
import type { PersonId, SessionId } from "@/types/common";
import type { AttendanceRecord, CheckInMethod } from "@/types/attendance";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";

export interface RecordAttendanceInput {
  sessionId: SessionId;
  personId: PersonId;
  method?: CheckInMethod;
}

/** Present attendance rows for a session. */
export function presentRecords(
  snapshot: ChurchSnapshot,
  sessionId: SessionId,
): AttendanceRecord[] {
  return snapshot.attendance.filter(
    (row) => row.sessionId === sessionId && row.status === "present",
  );
}

export function attendanceForPerson(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): AttendanceRecord[] {
  return snapshot.attendance
    .filter((row) => row.personId === personId && row.status === "present")
    .sort((left, right) => (left.recordedAt < right.recordedAt ? 1 : -1));
}

export function visitCount(snapshot: ChurchSnapshot, personId: PersonId): number {
  return snapshot.attendance.filter(
    (row) => row.personId === personId && row.status === "present",
  ).length;
}

/**
 * Records attendance for one person at one session.
 *
 * Checking the same person in twice is refused rather than silently
 * duplicated. A previously removed record is restored instead of creating a
 * second row, so the correction history stays intact.
 */
export function recordAttendance(
  snapshot: ChurchSnapshot,
  input: RecordAttendanceInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const session = snapshot.sessions.find((entry) => entry.id === input.sessionId);
  if (!session) return err("That session no longer exists.", "not_found");

  const person = findPerson(snapshot, input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  const existing = snapshot.attendance.find(
    (row) => row.sessionId === input.sessionId && row.personId === input.personId,
  );

  if (existing?.status === "present") {
    return err(
      `${displayName(person)} is already checked in to ${session.name}.`,
      "duplicate",
    );
  }

  const priorVisits = visitCount(snapshot, input.personId);
  const method = input.method ?? "search";

  let next: ChurchSnapshot;

  if (existing) {
    next = patch(snapshot, {
      attendance: replaceById(snapshot.attendance, existing.id, (row) => ({
        ...row,
        status: "present",
        method,
        recordedAt: ctx.nowIso,
        recordedBy: ctx.actorId,
        corrections: [
          ...row.corrections,
          { at: ctx.nowIso, by: ctx.actorId, action: "restored" as const },
        ],
      })),
    });
  } else {
    const record: AttendanceRecord = {
      id: ctx.id("attendance"),
      sessionId: input.sessionId,
      personId: input.personId,
      method,
      status: "present",
      recordedAt: ctx.nowIso,
      recordedBy: ctx.actorId,
      firstVisit: priorVisits === 0,
      corrections: [],
    };
    next = patch(snapshot, { attendance: [...snapshot.attendance, record] });
  }

  const visits = priorVisits + 1;
  const events: DomainEvent[] = [];

  // A visitor coming back is a meaningful moment: the automation engine
  // reviews the next follow-up action off the back of this event.
  if (person.visitor && visits > 1) {
    events.push({
      type: "visitor.returned",
      personId: person.id,
      sessionId: session.id,
      visitCount: visits,
    });
  }

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "attendance.recorded",
          category: "attendance",
          personId: person.id,
          summary: `${displayName(person)} was recorded at ${session.name} on ${formatDisplayDate(
            session.date,
          )}.`,
          meta: { sessionId: session.id },
        }),
      ]),
      events,
      [`${displayName(person)} checked in to ${session.name}.`],
    ),
  );
}

/** Removes an attendance record, keeping the row and recording the reason. */
export function removeAttendance(
  snapshot: ChurchSnapshot,
  recordId: string,
  reason: string | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const record = snapshot.attendance.find((row) => row.id === recordId);
  if (!record) return err("That attendance record no longer exists.", "not_found");
  if (record.status === "removed") return err("That record has already been removed.", "unchanged");

  const person = findPerson(snapshot, record.personId);
  const session = snapshot.sessions.find((entry) => entry.id === record.sessionId);

  const next = patch(snapshot, {
    attendance: replaceById(snapshot.attendance, recordId, (row) => ({
      ...row,
      status: "removed",
      corrections: [
        ...row.corrections,
        { at: ctx.nowIso, by: ctx.actorId, action: "removed" as const, reason },
      ],
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "attendance.corrected",
          category: "attendance",
          personId: record.personId,
          summary: `Attendance for ${person ? displayName(person) : "a person"} at ${
            session?.name ?? "a session"
          } was removed${reason ? ` — ${reason}` : ""}.`,
          meta: { sessionId: record.sessionId },
        }),
      ]),
      [],
      ["Attendance record corrected."],
    ),
  );
}

/** Moves a record to a different session, for a check-in on the wrong day. */
export function moveAttendance(
  snapshot: ChurchSnapshot,
  recordId: string,
  toSessionId: SessionId,
  reason: string | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const record = snapshot.attendance.find((row) => row.id === recordId);
  if (!record) return err("That attendance record no longer exists.", "not_found");

  const target = snapshot.sessions.find((entry) => entry.id === toSessionId);
  if (!target) return err("That session no longer exists.", "not_found");
  if (record.sessionId === toSessionId) return err("The record is already in that session.", "unchanged");

  const clash = snapshot.attendance.find(
    (row) =>
      row.sessionId === toSessionId &&
      row.personId === record.personId &&
      row.status === "present",
  );
  if (clash) return err("That person is already checked in to the target session.", "duplicate");

  const person = findPerson(snapshot, record.personId);

  const next = patch(snapshot, {
    attendance: replaceById(snapshot.attendance, recordId, (row) => ({
      ...row,
      sessionId: toSessionId,
      status: "present",
      corrections: [
        ...row.corrections,
        {
          at: ctx.nowIso,
          by: ctx.actorId,
          action: "moved_session" as const,
          reason,
          previousSessionId: row.sessionId,
        },
      ],
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "attendance.corrected",
          category: "attendance",
          personId: record.personId,
          summary: `${person ? displayName(person) : "A person"} was moved to ${target.name} on ${formatDisplayDate(
            target.date,
          )}.`,
          meta: { sessionId: toSessionId },
        }),
      ]),
      [],
      ["Attendance moved."],
    ),
  );
}

export interface CsvImportSummary {
  matched: number;
  skipped: number;
  /** Rows that could not be matched to a person in the directory. */
  unmatched: string[];
  duplicates: string[];
}

/**
 * Imports a mock attendance CSV with `name` and optional `phone` columns.
 * Unmatched rows are reported rather than guessed at, and no new people are
 * created by an import.
 */
export function importAttendanceCsv(
  snapshot: ChurchSnapshot,
  sessionId: SessionId,
  csv: string,
  ctx: CommandContext,
): Result<CommandResult & { summary: CsvImportSummary }> {
  const session = snapshot.sessions.find((entry) => entry.id === sessionId);
  if (!session) return err("That session no longer exists.", "not_found");

  const rows = parseCsvRecords(csv);
  if (!rows.length) return err("That file has no rows to import.", "invalid");

  const summary: CsvImportSummary = { matched: 0, skipped: 0, unmatched: [], duplicates: [] };
  let current = snapshot;

  for (const row of rows) {
    const name = row.name ?? `${row["first name"] ?? ""} ${row["last name"] ?? ""}`.trim();
    const phone = normalisePhone(row.phone);
    const needle = normalise(name);

    const person = current.people.find((candidate) => {
      if (phone && normalisePhone(candidate.phone) === phone) return true;
      return normalise(`${candidate.firstName} ${candidate.lastName}`) === needle;
    });

    if (!person) {
      summary.unmatched.push(name || phone || "(blank row)");
      continue;
    }

    const outcome = recordAttendance(
      current,
      { sessionId, personId: person.id, method: "csv_import" },
      ctx,
    );

    if (outcome.ok) {
      current = outcome.value.snapshot;
      summary.matched += 1;
    } else {
      summary.skipped += 1;
      if (outcome.code === "duplicate") summary.duplicates.push(displayName(person));
    }
  }

  return ok({
    ...result(current, [], [
      `${summary.matched} attendance record${summary.matched === 1 ? "" : "s"} imported.`,
      ...(summary.duplicates.length
        ? [`${summary.duplicates.length} already checked in.`]
        : []),
      ...(summary.unmatched.length
        ? [`${summary.unmatched.length} row${summary.unmatched.length === 1 ? "" : "s"} did not match anyone.`]
        : []),
    ]),
    summary,
  });
}
