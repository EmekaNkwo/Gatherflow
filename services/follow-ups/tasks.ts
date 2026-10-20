import { addDaysIso, formatDisplayDate } from "@/lib/dates";
import { nextReference } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { IsoDate, PersonId, TaskId, TeamMemberId } from "@/types/common";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  type FollowUpTask,
  type FollowUpTaskType,
  type TaskPriority,
} from "@/types/follow-up";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { TeamMember } from "@/types/team";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";
import { canBeContacted, needsContactPermission } from "./contact";

export interface CreateTaskInput {
  personId: PersonId;
  type: FollowUpTaskType;
  assigneeId?: TeamMemberId;
  dueDate?: IsoDate;
  priority?: TaskPriority;
  notes?: string;
  origin?: FollowUpTask["origin"];
  /** Set by automation rules to make task creation idempotent. */
  automationKey?: string;
}

/** Statuses that still need somebody to do something. */
export const OPEN_TASK_STATUSES = ["pending", "in_progress", "rescheduled"] as const;

export function isOpen(task: FollowUpTask): boolean {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
}

/**
 * Who a new task can actually go to. An inactive team member never receives
 * new work: the task is left unassigned instead, and the notice says so, so
 * it shows up as needing an owner rather than sitting with somebody away.
 */
function resolveAssignee(
  snapshot: ChurchSnapshot,
  assigneeId: TeamMemberId | undefined,
): { member?: TeamMember; skipped?: string; missing: boolean } {
  if (!assigneeId) return { missing: false };
  const member = snapshot.team.find((entry) => entry.id === assigneeId);
  if (!member) return { missing: true };
  if (!member.active) return { skipped: member.name, missing: false };
  return { member, missing: false };
}

/**
 * Creates a follow-up task.
 *
 * Refuses outright for a person who has opted out of contact, refuses a
 * messaging follow-up for somebody who never agreed to be contacted, refuses
 * a due date already in the past, and refuses silently (as a duplicate) when
 * a rule has already produced the same task. The notice names who actually
 * got the task.
 */
export function createFollowUpTask(
  snapshot: ChurchSnapshot,
  input: CreateTaskInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  if (person.contact.optedOut && input.type !== "pastoral_contact") {
    return err(
      `${displayName(person)} has asked not to be contacted, so no follow-up task was created.`,
      "opted_out",
    );
  }

  if (needsContactPermission(input.type) && !canBeContacted(person)) {
    return err(
      `${displayName(person)} hasn't agreed to be contacted, so a ${FOLLOW_UP_TASK_TYPE_LABELS[
        input.type
      ].toLowerCase()} can't be set up. You could add "${FOLLOW_UP_TASK_TYPE_LABELS.say_hello}" instead.`,
      "no_permission",
    );
  }

  if (input.dueDate && input.dueDate < ctx.today) {
    return err("Choose today or a later day for the follow-up.", "invalid");
  }

  if (input.automationKey) {
    const existing = snapshot.tasks.find((task) => task.automationKey === input.automationKey);
    if (existing) {
      return err(`A follow-up task for this already exists (${existing.reference}).`, "duplicate");
    }
  }

  const assignee = resolveAssignee(snapshot, input.assigneeId);
  // A person picked by hand must exist; a rule pointing at somebody since
  // removed simply leaves the task for the team to pick up.
  if (assignee.missing && (input.origin ?? "manual") === "manual") {
    return err("That team member no longer exists.", "not_found");
  }

  const dueDate =
    input.dueDate ?? addDaysIso(ctx.today, snapshot.settings.defaultFollowUpDueInDays);

  const task: FollowUpTask = {
    id: ctx.id("task"),
    reference: nextReference(
      "FU",
      snapshot.tasks.map((entry) => entry.reference),
    ),
    personId: input.personId,
    type: input.type,
    assigneeId: assignee.member?.id,
    priority: input.priority ?? "normal",
    dueDate,
    status: "pending",
    notes: input.notes,
    origin: input.origin ?? "manual",
    automationKey: input.automationKey,
    rescheduleHistory: [],
    createdAt: ctx.nowIso,
    createdBy: ctx.actorId,
  };

  const withTask = patch(snapshot, { tasks: [...snapshot.tasks, task] });
  const label = FOLLOW_UP_TASK_TYPE_LABELS[task.type].toLowerCase();

  return ok(
    result(
      withActivity(withTask, ctx, [
        activity(ctx, {
          type: "follow_up.created",
          category: "follow_up",
          personId: person.id,
          summary: `${task.reference}: ${label} created for ${displayName(person)}.`,
          meta: { taskId: task.id },
          // That somebody needs pastoral care is itself pastoral information.
          visibility: task.type === "pastoral_contact" ? "restricted" : "general",
        }),
      ]),
      [],
      [
        `${task.reference} created for ${displayName(person)}${
          assignee.member ? `, assigned to ${assignee.member.name}` : ", with nobody assigned yet"
        }, due ${formatDisplayDate(dueDate)}.`,
        ...(assignee.skipped
          ? [`${assignee.skipped} is inactive, so ${task.reference} has been left with nobody assigned.`]
          : []),
      ],
    ),
  );
}

export function assignTask(
  snapshot: ChurchSnapshot,
  taskId: TaskId,
  assigneeId: TeamMemberId | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  if (!task) return err("That task no longer exists.", "not_found");
  if (!isOpen(task)) return err("Only open tasks can be reassigned.", "closed");

  const member = assigneeId
    ? snapshot.team.find((entry) => entry.id === assigneeId)
    : undefined;
  if (assigneeId && !member) return err("That team member no longer exists.", "not_found");
  if (member && !member.active) {
    return err(`${member.name} is marked as inactive and cannot take new tasks.`, "inactive");
  }

  const person = findPerson(snapshot, task.personId);
  const next = patch(snapshot, {
    tasks: replaceById(snapshot.tasks, taskId, (entry) => ({ ...entry, assigneeId })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "follow_up.assigned",
          category: "follow_up",
          personId: task.personId,
          summary: member
            ? `${task.reference} assigned to ${member.name}${person ? ` for ${displayName(person)}` : ""}.`
            : `${task.reference} was unassigned.`,
          meta: { taskId },
        }),
      ]),
      [],
      [member ? `${task.reference} assigned to ${member.name}.` : `${task.reference} unassigned.`],
    ),
  );
}

export function rescheduleTask(
  snapshot: ChurchSnapshot,
  taskId: TaskId,
  dueDate: IsoDate,
  reason: string | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  if (!task) return err("That task no longer exists.", "not_found");
  if (!isOpen(task)) return err("Completed and cancelled tasks cannot be rescheduled.", "closed");
  if (dueDate === task.dueDate) return err("That is already the due date.", "unchanged");
  if (dueDate < ctx.today) return err("Choose today or a later day.", "invalid");

  const next = patch(snapshot, {
    tasks: replaceById(snapshot.tasks, taskId, (entry) => ({
      ...entry,
      dueDate,
      // Rescheduling keeps the task open; the status records that the date moved.
      status: "rescheduled",
      rescheduleHistory: [
        ...entry.rescheduleHistory,
        { from: entry.dueDate, to: dueDate, at: ctx.nowIso, by: ctx.actorId, reason },
      ],
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "follow_up.rescheduled",
          category: "follow_up",
          personId: task.personId,
          summary: `${task.reference} moved to ${formatDisplayDate(dueDate)}${reason ? ` — ${reason}` : ""}.`,
          meta: { taskId },
        }),
      ]),
      [],
      [`${task.reference} moved to ${formatDisplayDate(dueDate)}.`],
    ),
  );
}

export function startTask(
  snapshot: ChurchSnapshot,
  taskId: TaskId,
): Result<CommandResult> {
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  if (!task) return err("That task no longer exists.", "not_found");
  if (!isOpen(task)) return err("That task is already closed.", "closed");

  return ok(
    result(
      patch(snapshot, {
        tasks: replaceById(snapshot.tasks, taskId, (entry) => ({
          ...entry,
          status: "in_progress",
        })),
      }),
      [],
      [`${task.reference} marked as in progress.`],
    ),
  );
}

export function cancelTask(
  snapshot: ChurchSnapshot,
  taskId: TaskId,
  reason: string | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  if (!task) return err("That task no longer exists.", "not_found");
  // Only open work can be stopped: cancelling twice would log it twice.
  if (!isOpen(task)) return err("That follow-up has already been closed.", "closed");

  const next = patch(snapshot, {
    tasks: replaceById(snapshot.tasks, taskId, (entry) => ({
      ...entry,
      status: "cancelled",
      notes: reason ? `${entry.notes ? `${entry.notes}\n` : ""}Cancelled: ${reason}` : entry.notes,
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "follow_up.cancelled",
          category: "follow_up",
          personId: task.personId,
          summary: `${task.reference} was cancelled${reason ? ` — ${reason}` : ""}.`,
          meta: { taskId },
        }),
      ]),
      [],
      [`${task.reference} cancelled.`],
    ),
  );
}

/** Bulk creation used by the visitor directory's "create tasks" action. */
export function createTasksForPeople(
  snapshot: ChurchSnapshot,
  personIds: readonly PersonId[],
  input: Omit<CreateTaskInput, "personId">,
  ctx: CommandContext,
): CommandResult {
  let current = snapshot;
  const notices: string[] = [];
  let created = 0;
  const skipped: string[] = [];

  for (const personId of personIds) {
    const outcome = createFollowUpTask(current, { ...input, personId }, ctx);
    if (outcome.ok) {
      current = outcome.value.snapshot;
      created += 1;
    } else {
      const person = findPerson(current, personId);
      skipped.push(person ? displayName(person) : personId);
    }
  }

  notices.push(`${created} follow-up task${created === 1 ? "" : "s"} created.`);
  if (skipped.length) {
    notices.push(`Skipped ${skipped.length}: ${skipped.join(", ")}.`);
  }

  return result(current, [], notices);
}
