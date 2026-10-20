import { formatDisplayDate } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { PersonId, SessionId } from "@/types/common";
import type { AttendanceRecord, AttendanceSession, CheckInMethod } from "@/types/attendance";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";
import { settleVisitChange } from "./visit-changes";

export { visitCount } from "./visits";

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

/**
 * A service that has not happened yet cannot have been attended. The morning
 * of the service is fine: "today" counts.
 */
function notYetHappened(session: AttendanceSession, ctx: CommandContext): Result<never> | null {
  if (session.date <= ctx.today) return null;
  return err(
    `${session.name} on ${formatDisplayDate(session.date)} hasn't happened yet. Check people in on the day.`,
    "invalid",
  );
}

/**
 * Records attendance for one person at one session.
 *
 * Checking the same person in twice is refused rather than silently
 * duplicated. A previously removed record is restored instead of creating a
 * second row, so the correction history stays intact. Check-in to a service
 * dated after today is refused.
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

  const future = notYetHappened(session, ctx);
  if (future) return future;

  const method = input.method ?? "search";

  const recorded = existing
    ? patch(snapshot, {
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
      })
    : patch(snapshot, {
        attendance: [
          ...snapshot.attendance,
          {
            id: ctx.id("attendance"),
            sessionId: input.sessionId,
            personId: input.personId,
            method,
            status: "present",
            recordedAt: ctx.nowIso,
            recordedBy: ctx.actorId,
            // Worked out from the dates of every visit just below.
            firstVisit: false,
            corrections: [],
          },
        ],
      });

  // A visitor coming back is a meaningful moment: the automation engine
  // reviews the next follow-up action off the back of this event.
  const settled = settleVisitChange(snapshot, recorded, person.id, session, ctx);

  return ok(
    result(
      withActivity(settled.snapshot, ctx, [
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
      settled.events,
      [`${displayName(person)} checked in to ${session.name}.`, ...settled.notices],
    ),
  );
}

/**
 * Removes an attendance record, keeping the row and recording the reason.
 * When that takes away a return visit, the "Returned" stage and its
 * follow-up are undone as well.
 */
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

  const removed = patch(snapshot, {
    attendance: replaceById(snapshot.attendance, recordId, (row) => ({
      ...row,
      status: "removed",
      corrections: [
        ...row.corrections,
        { at: ctx.nowIso, by: ctx.actorId, action: "removed" as const, reason },
      ],
    })),
  });
  const settled = settleVisitChange(
    snapshot,
    removed,
    record.personId,
    { id: record.sessionId, date: session?.date ?? ctx.today },
    ctx,
  );

  return ok(
    result(
      withActivity(settled.snapshot, ctx, [
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
      settled.events,
      ["Attendance record corrected.", ...settled.notices],
    ),
  );
}

/**
 * Moves a check-in made against the wrong service.
 *
 * When the person already has a row at the target service that was taken off
 * the list earlier, that row is restored and this one is taken off instead —
 * one row per person per service, and both corrections stay on record.
 */
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

  const atTarget = snapshot.attendance.find(
    (row) => row.sessionId === toSessionId && row.personId === record.personId,
  );
  if (atTarget?.status === "present") {
    return err("That person is already checked in to the target session.", "duplicate");
  }

  const future = notYetHappened(target, ctx);
  if (future) return future;

  const person = findPerson(snapshot, record.personId);
  const moved = atTarget
    ? swapIntoRemovedRow(snapshot, record, atTarget, target, reason, ctx)
    : patch(snapshot, {
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
  const settled = settleVisitChange(snapshot, moved, record.personId, target, ctx);

  return ok(
    result(
      withActivity(settled.snapshot, ctx, [
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
      settled.events,
      ["Attendance moved.", ...settled.notices],
    ),
  );
}

/** Restores the person's earlier row at the target and takes the source off. */
function swapIntoRemovedRow(
  snapshot: ChurchSnapshot,
  source: AttendanceRecord,
  removedAtTarget: AttendanceRecord,
  target: AttendanceSession,
  reason: string | undefined,
  ctx: CommandContext,
): ChurchSnapshot {
  const note = reason ?? `Moved to ${target.name} on ${formatDisplayDate(target.date)}`;
  const attendance = snapshot.attendance.map((row) => {
    if (row.id === source.id) {
      return {
        ...row,
        status: "removed" as const,
        corrections: [
          ...row.corrections,
          { at: ctx.nowIso, by: ctx.actorId, action: "removed" as const, reason: note },
        ],
      };
    }
    if (row.id === removedAtTarget.id) {
      return {
        ...row,
        status: "present" as const,
        method: source.method,
        recordedAt: ctx.nowIso,
        recordedBy: ctx.actorId,
        corrections: [
          ...row.corrections,
          {
            at: ctx.nowIso,
            by: ctx.actorId,
            action: "restored" as const,
            reason,
            previousSessionId: source.sessionId,
          },
        ],
      };
    }
    return row;
  });
  return patch(snapshot, { attendance });
}
