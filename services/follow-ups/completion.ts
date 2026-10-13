import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { TaskId } from "@/types/common";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  TASK_OUTCOME_LABELS,
  type TaskOutcome,
} from "@/types/follow-up";
import type { ClosureReason, Person } from "@/types/person";
import type { ChurchSettings } from "@/types/settings";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";
import { advanceStage, closureStage } from "../visitors/pipeline";
import { isOpen } from "./tasks";

export interface CompleteTaskInput {
  taskId: TaskId;
  outcome: TaskOutcome;
  outcomeNote?: string;
}

/** Outcomes that mean we actually reached the person. */
const SUCCESSFUL_OUTCOMES: readonly TaskOutcome[] = ["contacted"];

/** Outcomes that count as a contact attempt, whether or not we got through. */
const ATTEMPT_OUTCOMES: readonly TaskOutcome[] = [
  "contacted",
  "no_answer",
  "requested_another_time",
  "wrong_details",
  "other",
];

/** Outcomes that stop follow-up, with the closure they record. */
const CLOSING_OUTCOMES: Partial<Record<TaskOutcome, ClosureReason>> = {
  not_interested: "contact_declined",
  needs_another_team: "referred",
};

/**
 * Completes a follow-up task and records what the outcome means for the
 * person: a successful contact moves them along the pipeline, a refusal
 * stops follow-up, and repeated no-answers close the record once the
 * church's agreed number of attempts has been reached.
 */
export function completeTask(
  snapshot: ChurchSnapshot,
  input: CompleteTaskInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const task = snapshot.tasks.find((entry) => entry.id === input.taskId);
  if (!task) return err("That task no longer exists.", "not_found");
  if (!isOpen(task)) return err("That task has already been closed.", "closed");

  const person = findPerson(snapshot, task.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  let next = patch(snapshot, {
    tasks: replaceById(snapshot.tasks, input.taskId, (entry) => ({
      ...entry,
      status: "completed",
      outcome: input.outcome,
      outcomeNote: input.outcomeNote,
      completedAt: ctx.nowIso,
      completedBy: ctx.actorId,
    })),
  });

  const notices: string[] = [
    `${task.reference} completed — ${TASK_OUTCOME_LABELS[input.outcome].toLowerCase()}.`,
  ];
  const events: DomainEvent[] = [
    {
      type: "task.completed",
      taskId: task.id,
      personId: person.id,
      outcome: input.outcome,
    },
  ];

  const outcomeChange = applyOutcomeToVisitor(person, input.outcome, snapshot.settings, ctx);

  if (outcomeChange) {
    next = patch(next, {
      people: replaceById(next.people, person.id, (entry) => ({
        ...outcomeChange.update(entry),
        updatedAt: ctx.nowIso,
      })),
    });

    if (outcomeChange.stoppedReason) {
      // Nothing further should be created for this person.
      const open = next.tasks.filter(
        (entry) =>
          entry.personId === person.id && entry.id !== task.id && isOpen(entry),
      );
      next = patch(next, {
        tasks: next.tasks.map((entry) =>
          open.some((candidate) => candidate.id === entry.id)
            ? {
                ...entry,
                status: "cancelled",
                notes: `${entry.notes ? `${entry.notes}\n` : ""}Cancelled: follow-up stopped.`,
              }
            : entry,
        ),
      });
      events.push({ type: "visitor.follow_up_stopped", personId: person.id });
      notices.push(outcomeChange.notice);
      if (open.length) {
        notices.push(`${open.length} other open task${open.length === 1 ? "" : "s"} cancelled.`);
      }
    } else if (outcomeChange.notice) {
      notices.push(outcomeChange.notice);
    }
  }

  if (input.outcome === "wrong_details") {
    notices.push("Please check and update the contact details before trying again.");
  }

  const label = FOLLOW_UP_TASK_TYPE_LABELS[task.type].toLowerCase();

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "follow_up.completed",
          category: "follow_up",
          personId: person.id,
          summary: `${task.reference}: ${label} completed for ${displayName(person)} — ${TASK_OUTCOME_LABELS[
            input.outcome
          ].toLowerCase()}.`,
          meta: { taskId: task.id },
        }),
        ...(outcomeChange?.stoppedReason
          ? [
              activity(ctx, {
                type: "visitor.closed" as const,
                category: "visitor" as const,
                personId: person.id,
                summary: outcomeChange.notice,
              }),
            ]
          : []),
        ...(outcomeChange?.stageId
          ? [
              activity(ctx, {
                type: "visitor.stage_changed" as const,
                category: "visitor" as const,
                personId: person.id,
                summary: `${displayName(person)} moved to "${
                  snapshot.settings.pipelineStages.find(
                    (stage) => stage.id === outcomeChange.stageId,
                  )?.name ?? outcomeChange.stageId
                }".`,
                meta: { stageId: outcomeChange.stageId },
              }),
            ]
          : []),
      ]),
      events,
      notices,
    ),
  );
}

interface OutcomeChange {
  update: (person: Person) => Person;
  stageId?: string;
  stoppedReason?: ClosureReason;
  notice: string;
}

/**
 * Works out what an outcome means for a visitor record. Members without a
 * visitor profile only get their contact timestamp updated.
 */
function applyOutcomeToVisitor(
  person: Person,
  outcome: TaskOutcome,
  settings: ChurchSettings,
  ctx: CommandContext,
): OutcomeChange | null {
  const attempted = ATTEMPT_OUTCOMES.includes(outcome);
  const succeeded = SUCCESSFUL_OUTCOMES.includes(outcome);

  if (!person.visitor) {
    if (!attempted) return null;
    return {
      update: (entry) => entry,
      notice: "",
    };
  }

  const closing = CLOSING_OUTCOMES[outcome];
  const attempts = person.visitor.contactAttempts + (attempted ? 1 : 0);
  const exhausted =
    !succeeded &&
    outcome === "no_answer" &&
    attempts >= settings.engagement.maxContactAttempts;

  const closureReason: ClosureReason | undefined = closing ?? (exhausted ? "no_response" : undefined);
  const closed = closureStage(settings);
  const stageId = closureReason
    ? closed?.id
    : (succeeded ? advanceStage(settings, person, "contacted") : advanceStage(settings, person, "contact_attempted")) ??
      undefined;

  return {
    update: (entry) =>
      entry.visitor
        ? {
            ...entry,
            visitor: {
              ...entry.visitor,
              contactAttempts: attempts,
              lastContactAt: attempted ? ctx.nowIso : entry.visitor.lastContactAt,
              stageId: stageId ?? entry.visitor.stageId,
              stageUpdatedAt: stageId ? ctx.nowIso : entry.visitor.stageUpdatedAt,
              closure: closureReason
                ? {
                    reason: closureReason,
                    note: exhausted
                      ? `No response after ${attempts} attempts, the number agreed by the church.`
                      : undefined,
                    recordedAt: ctx.nowIso,
                  }
                : entry.visitor.closure,
            },
          }
        : entry,
    stageId: closureReason ? undefined : (stageId ?? undefined),
    stoppedReason: closureReason,
    notice: closureReason
      ? closureReason === "no_response"
        ? `Follow-up for ${displayName(person)} stopped after ${attempts} attempts.`
        : closureReason === "referred"
          ? `${displayName(person)} was referred to another team and follow-up here has stopped.`
          : `${displayName(person)} is not interested in further contact, so follow-up has stopped.`
      : "",
  };
}
