import { err, ok, type Result } from "@/lib/result";
import { formatDisplayDate } from "@/lib/dates";
import type { GroupId, IsoDate, SessionId } from "@/types/common";
import type { AttendanceSession, ServiceType } from "@/types/attendance";
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

/** Creates a service, event or group meeting that attendance can be recorded against. */
export function createSession(
  snapshot: ChurchSnapshot,
  input: CreateSessionInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const name = input.name.trim();
  if (!name) return err("Give the session a name.", "invalid");

  const duplicate = snapshot.sessions.find(
    (session) =>
      session.date === input.date &&
      session.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    return err(
      `"${duplicate.name}" already exists on ${formatDisplayDate(duplicate.date)}.`,
      "duplicate",
    );
  }

  const session: AttendanceSession = {
    id: ctx.id("session"),
    name,
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
  return [...snapshot.sessions].sort((left, right) => (left.date < right.date ? 1 : -1));
}

export function upcomingSessions(snapshot: ChurchSnapshot, today: IsoDate): AttendanceSession[] {
  return sessionsByDate(snapshot)
    .filter((session) => session.date >= today)
    .reverse();
}
