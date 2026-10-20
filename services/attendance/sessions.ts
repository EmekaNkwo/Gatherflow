import { err, ok, type Result } from "@/lib/result";
import { addDaysIso, formatDisplayDate } from "@/lib/dates";
import type { GroupId, IsoDate, SessionId } from "@/types/common";
import { SERVICE_TYPE_LABELS, type AttendanceSession, type ServiceType } from "@/types/attendance";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { activity, patch, replaceById, withActivity } from "../core/snapshot";

export interface CreateSessionInput {
  name: string;
  date: IsoDate;
  startTime: string;
  type: ServiceType;
  groupId?: GroupId;
  notes?: string;
}

export interface UpdateSessionInput extends CreateSessionInput {
  sessionId: SessionId;
}

/** The earliest date a service can be recorded for. */
export const EARLIEST_SESSION_DATE: IsoDate = "2000-01-01";
/** How far ahead a service can be planned. */
export const SESSION_DAYS_AHEAD = 2 * 366;

/** The latest date a service can be planned for, counted from today. */
export function latestSessionDate(today: IsoDate): IsoDate {
  return addDaysIso(today, SESSION_DAYS_AHEAD);
}

/** A mistyped year ("1900", "2062") is caught before it is saved. */
function checkDate(date: IsoDate, ctx: CommandContext): Result<true> {
  if (date < EARLIEST_SESSION_DATE) {
    return err(`That date is too far back. Pick a date from ${formatDisplayDate(EARLIEST_SESSION_DATE)} on.`, "invalid");
  }
  const latest = latestSessionDate(ctx.today);
  if (date > latest) {
    return err(`That date is too far ahead. Pick a date before ${formatDisplayDate(latest)}.`, "invalid");
  }
  return ok(true);
}

/**
 * Two records for the same gathering: same day, same start time, same kind
 * (and same group, for a group meeting). The name is only a label, so two
 * services called "Sunday service" at 08:00 and 10:00 are both fine.
 */
function findClash(
  snapshot: ChurchSnapshot,
  input: CreateSessionInput,
  exceptId?: SessionId,
): AttendanceSession | undefined {
  return snapshot.sessions.find(
    (session) =>
      session.id !== exceptId &&
      session.date === input.date &&
      session.startTime === input.startTime &&
      session.type === input.type &&
      (session.groupId ?? null) === (input.groupId ?? null),
  );
}

function clashMessage(clash: AttendanceSession): string {
  return `There is already a ${SERVICE_TYPE_LABELS[clash.type].toLowerCase()} on ${formatDisplayDate(
    clash.date,
  )} at ${clash.startTime} ("${clash.name}").`;
}

function validate(
  snapshot: ChurchSnapshot,
  input: CreateSessionInput,
  ctx: CommandContext,
  exceptId?: SessionId,
): Result<string> {
  const name = input.name.trim();
  if (!name) return err("Give the session a name.", "invalid");

  const date = checkDate(input.date, ctx);
  if (!date.ok) return date;

  const clash = findClash(snapshot, input, exceptId);
  if (clash) return err(clashMessage(clash), "duplicate");
  return ok(name);
}

/** Creates a service, event or group meeting that attendance can be recorded against. */
export function createSession(
  snapshot: ChurchSnapshot,
  input: CreateSessionInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const valid = validate(snapshot, input, ctx);
  if (!valid.ok) return valid;

  const session: AttendanceSession = {
    id: ctx.id("session"),
    name: valid.value,
    date: input.date,
    startTime: input.startTime,
    type: input.type,
    groupId: input.groupId,
    notes: input.notes?.trim() || undefined,
    createdAt: ctx.nowIso,
  };

  const next = patch(snapshot, { sessions: [...snapshot.sessions, session] });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "attendance.session_created",
          category: "attendance",
          summary: `${session.name} on ${formatDisplayDate(session.date)} was created.`,
          meta: { sessionId: session.id },
        }),
      ]),
      [],
      [`${session.name} created.`],
    ),
  );
}

function hasAttendance(snapshot: ChurchSnapshot, sessionId: SessionId): boolean {
  return snapshot.attendance.some((row) => row.sessionId === sessionId && row.status === "present");
}

/**
 * Corrects a service's name, date, time or kind. A service people have
 * already been checked in to cannot move to a day that hasn't happened yet.
 */
export function updateSession(
  snapshot: ChurchSnapshot,
  input: UpdateSessionInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const existing = snapshot.sessions.find((entry) => entry.id === input.sessionId);
  if (!existing) return err("That session no longer exists.", "not_found");

  const valid = validate(snapshot, input, ctx, input.sessionId);
  if (!valid.ok) return valid;

  if (input.date > ctx.today && hasAttendance(snapshot, input.sessionId)) {
    return err(
      "People are already checked in to this service, so it can't move to a day that hasn't happened yet.",
      "invalid",
    );
  }

  const next = patch(snapshot, {
    sessions: replaceById(snapshot.sessions, input.sessionId, (entry) => ({
      ...entry,
      name: valid.value,
      date: input.date,
      startTime: input.startTime,
      type: input.type,
      groupId: input.groupId,
      notes: input.notes === undefined ? entry.notes : input.notes.trim() || undefined,
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "attendance.session_updated",
          category: "attendance",
          summary: `${valid.value} on ${formatDisplayDate(input.date)} was updated.`,
          meta: { sessionId: input.sessionId },
        }),
      ]),
      [],
      [`${valid.value} saved.`],
    ),
  );
}

/**
 * Deletes a service added by mistake. A service with anybody checked in is
 * refused: their attendance is a record of something that happened, so move
 * or undo those check-ins first. Check-ins that were already taken off the
 * list go with the service.
 */
export function deleteSession(
  snapshot: ChurchSnapshot,
  sessionId: SessionId,
  ctx: CommandContext,
): Result<CommandResult> {
  const session = snapshot.sessions.find((entry) => entry.id === sessionId);
  if (!session) return err("That session no longer exists.", "not_found");

  const present = snapshot.attendance.filter(
    (row) => row.sessionId === sessionId && row.status === "present",
  ).length;
  if (present > 0) {
    return err(
      `${present} ${present === 1 ? "person is" : "people are"} checked in to ${session.name}, so it can't be deleted. Move or undo those check-ins first.`,
      "invalid",
    );
  }

  const next = patch(snapshot, {
    sessions: snapshot.sessions.filter((entry) => entry.id !== sessionId),
    attendance: snapshot.attendance.some((row) => row.sessionId === sessionId)
      ? snapshot.attendance.filter((row) => row.sessionId !== sessionId)
      : snapshot.attendance,
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "attendance.session_deleted",
          category: "attendance",
          summary: `${session.name} on ${formatDisplayDate(session.date)} was deleted.`,
          meta: { sessionId },
        }),
      ]),
      [],
      [`${session.name} deleted.`],
    ),
  );
}

export function updateSessionNotes(
  snapshot: ChurchSnapshot,
  sessionId: SessionId,
  notes: string,
): Result<CommandResult> {
  const session = snapshot.sessions.find((entry) => entry.id === sessionId);
  if (!session) return err("That session no longer exists.", "not_found");

  return ok(
    result(
      patch(snapshot, {
        sessions: replaceById(snapshot.sessions, sessionId, (entry) => ({
          ...entry,
          notes: notes.trim() || undefined,
        })),
      }),
      [],
      ["Session notes saved."],
    ),
  );
}

/** Sessions ordered newest first. */
export function sessionsByDate(snapshot: ChurchSnapshot): AttendanceSession[] {
  return [...snapshot.sessions].sort(
    (left, right) =>
      right.date.localeCompare(left.date) || right.startTime.localeCompare(left.startTime),
  );
}

export function upcomingSessions(snapshot: ChurchSnapshot, today: IsoDate): AttendanceSession[] {
  return sessionsByDate(snapshot)
    .filter((session) => session.date >= today)
    .reverse();
}

/**
 * Services that have already happened in the last `weeks` weeks, newest
 * first — including any with nobody checked in, so a service added after
 * the fact can always be reached, filled in, corrected or deleted.
 */
export function pastSessions(
  snapshot: ChurchSnapshot,
  today: IsoDate,
  weeks: number,
): AttendanceSession[] {
  const since = addDaysIso(today, -7 * weeks);
  return sessionsByDate(snapshot).filter(
    (session) => session.date <= today && session.date >= since,
  );
}
