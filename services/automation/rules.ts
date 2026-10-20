import { addDaysIso, formatDisplayDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  type FollowUpTask,
  type FollowUpTaskType,
  type TaskOutcome,
} from "@/types/follow-up";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { AutomationRuleConfig, AutomationRuleId } from "@/types/settings";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";
import { canBeContacted } from "../follow-ups/contact";
import { createFollowUpTask } from "../follow-ups/tasks";
import { isOpen } from "../follow-ups/tasks";
import { advanceStage, isTerminalStage } from "../visitors/pipeline";

/**
 * The follow-up automation engine.
 *
 * Rules react to domain events, never to React renders, and every generated
 * task carries an `automationKey`, so replaying the same event can never
 * produce a second task. Rules do not emit events of their own, so a single
 * pass is enough and there is no way to loop.
 */
export function runAutomations(
  snapshot: ChurchSnapshot,
  events: readonly DomainEvent[],
  ctx: CommandContext,
): CommandResult {
  let current = snapshot;
  const notices: string[] = [];

  const stopped = new Set(
    events
      .filter((event) => event.type === "visitor.follow_up_stopped")
      .map((event) => event.personId),
  );

  for (const event of events) {
    switch (event.type) {
      case "visitor.registered": {
        const rule = ruleFor(current, "first_visit_welcome");
        if (!rule || stopped.has(event.personId)) break;
        const person = findPerson(current, event.personId);
        if (!person) break;

        // Without permission nobody is messaged: the welcome becomes a hello
        // in person at their next visit, and the notice says exactly that.
        const consented = canBeContacted(person);
        // Registered as having been before: welcome them back, not as new.
        const returning = Boolean(person.visitor?.returningVisitor);
        const automationKey = `first_visit_welcome:${event.personId}:${event.firstVisitDate}`;
        const outcome = createFollowUpTask(
          current,
          {
            personId: event.personId,
            type: consented ? "welcome_message" : "say_hello",
            assigneeId: person.visitor?.assignedTo ?? rule.defaultAssigneeId,
            dueDate: addDaysIso(ctx.today, rule.dueInDays),
            priority: person.visitor?.assignedTo ? "normal" : "high",
            notes: consented
              ? returning
                ? "They've been before: send a welcome-back message."
                : "Send the first-time visitor welcome message."
              : "They haven't agreed to be contacted, so say hello in person next time they come. No messages.",
            origin: "rule:first_visit_welcome",
            automationKey,
          },
          ctx,
        );

        if (outcome.ok) {
          current = outcome.value.snapshot;
          const created = createdTask(current, automationKey);
          notices.push(
            consented
              ? `${returning ? "Welcome-back" : "Welcome"} follow-up created ${ownerPhrase(current, created)}, due ${formatDisplayDate(created?.dueDate)}.`
              : `They haven't agreed to be contacted, so no welcome message will be sent. A "${FOLLOW_UP_TASK_TYPE_LABELS.say_hello.toLowerCase()}" follow-up was created ${ownerPhrase(current, created)}, due ${formatDisplayDate(created?.dueDate)}.`,
            ...inactiveNotices(outcome.value.notices),
          );
        } else if (outcome.code === "opted_out") {
          notices.push(outcome.error);
        }
        break;
      }

      case "visitor.returned": {
        const person = findPerson(current, event.personId);
        if (!person?.visitor) break;

        // Record the return on the journey even when the rule is disabled
        // for task creation — the stage reflects what actually happened.
        const stage = advanceStage(current.settings, person, "returned");
        if (stage) {
          current = patch(current, {
            people: replaceById(current.people, person.id, (entry) => ({
              ...entry,
              visitor: entry.visitor
                ? { ...entry.visitor, stageId: stage, stageUpdatedAt: ctx.nowIso }
                : entry.visitor,
              updatedAt: ctx.nowIso,
            })),
          });
          current = withActivity(current, ctx, [
            activity(ctx, {
              type: "visitor.stage_changed",
              category: "visitor",
              personId: person.id,
              summary: `${displayName(person)} came back for visit ${event.visitCount} and moved to "Returned".`,
              meta: { stageId: stage },
            }),
          ]);
          notices.push(`${displayName(person)} moved to Returned (visit ${event.visitCount}).`);
        }

        // They came back, so an open invitation to come has done its job.
        // Closing it first also stops it hiding the check-in below.
        const resolved = resolveInvitations(current, person.id, ctx);
        current = resolved.snapshot;
        notices.push(...resolved.notices);

        // Past here is only the check-in task, which the rule controls.
        const rule = ruleFor(current, "return_visit_review");
        if (!rule) break;
        if (stopped.has(event.personId) || person.visitor.closure) break;
        if (isTerminalStage(current.settings, person.visitor.stageId)) break;

        const hasOpenWork = current.tasks.some(
          (task) => task.personId === person.id && isOpen(task),
        );
        if (hasOpenWork) break;

        const consented = canBeContacted(person);
        const automationKey = `return_visit_review:${person.id}:${event.visitCount}`;
        const outcome = createFollowUpTask(
          current,
          {
            personId: person.id,
            type: consented ? "check_in" : "say_hello",
            assigneeId: person.visitor.assignedTo ?? rule.defaultAssigneeId,
            dueDate: addDaysIso(ctx.today, rule.dueInDays),
            notes: consented
              ? `Returned for visit ${event.visitCount} — ask how they are finding things.`
              : `Returned for visit ${event.visitCount}. They haven't agreed to be contacted, so say hello in person.`,
            origin: "rule:return_visit_review",
            automationKey,
          },
          ctx,
        );
        if (outcome.ok) {
          current = outcome.value.snapshot;
          const created = createdTask(current, automationKey);
          notices.push(
            `${FOLLOW_UP_TASK_TYPE_LABELS[created?.type ?? "check_in"]} follow-up for the return visit created ${ownerPhrase(current, created)}, due ${formatDisplayDate(created?.dueDate)}.`,
            ...inactiveNotices(outcome.value.notices),
          );
        }
        break;
      }

      case "visitor.membership_interest": {
        const rule = ruleFor(current, "membership_orientation");
        if (!rule || stopped.has(event.personId)) break;

        const automationKey = `membership_orientation:${event.personId}`;
        const outcome = createFollowUpTask(
          current,
          {
            personId: event.personId,
            type: "membership_orientation",
            assigneeId: rule.defaultAssigneeId,
            dueDate: addDaysIso(ctx.today, rule.dueInDays),
            priority: "high",
            notes: "Invite to the next membership orientation session.",
            origin: "rule:membership_orientation",
            automationKey,
          },
          ctx,
        );
        if (outcome.ok) {
          current = outcome.value.snapshot;
          notices.push(
            `A membership orientation task was created ${ownerPhrase(current, createdTask(current, automationKey))}.`,
            ...inactiveNotices(outcome.value.notices),
          );
        }
        break;
      }

      case "task.completed": {
        const rule = ruleFor(current, "next_action_suggestion");
        if (!rule || stopped.has(event.personId)) break;

        const person = findPerson(current, event.personId);
        if (!person) break;
        // Never chase someone who has closed the conversation.
        if (person.visitor?.closure || person.contact.optedOut) break;

        const task = current.tasks.find((entry) => entry.id === event.taskId);
        if (!task) break;

        const next = nextActionFor(event.outcome, task.type);
        if (!next) break;
        if (!canBeContacted(person)) {
          notices.push(
            `No next step was set up, because ${displayName(person)} hasn't agreed to be contacted.`,
          );
          break;
        }

        const automationKey = `next_action:${task.id}`;
        const outcome = createFollowUpTask(
          current,
          {
            personId: person.id,
            type: next.type,
            assigneeId: task.assigneeId ?? rule.defaultAssigneeId,
            dueDate: addDaysIso(ctx.today, next.inDays ?? rule.dueInDays),
            priority: task.priority,
            notes: next.note,
            origin: "rule:next_action_suggestion",
            automationKey,
          },
          ctx,
        );
        if (outcome.ok) {
          current = outcome.value.snapshot;
          const created = createdTask(current, automationKey);
          notices.push(
            `Next step created ${ownerPhrase(current, created)}, due ${formatDisplayDate(created?.dueDate)}: ${next.note}`,
            ...inactiveNotices(outcome.value.notices),
          );
        }
        break;
      }

      // `overdue_alert` deliberately stores nothing: overdue work is derived
      // from due dates whenever it is displayed, so it can never drift.
      case "visitor.stage_changed":
      case "visitor.follow_up_stopped":
      case "member.registered":
      default:
        break;
    }
  }

  return result(current, [], notices);
}

function createdTask(snapshot: ChurchSnapshot, automationKey: string): FollowUpTask | undefined {
  return snapshot.tasks.find((task) => task.automationKey === automationKey);
}

/** "for Grace Mensah", or "with nobody assigned yet": who actually got it. */
function ownerPhrase(snapshot: ChurchSnapshot, task: FollowUpTask | undefined): string {
  const owner = task?.assigneeId
    ? snapshot.team.find((member) => member.id === task.assigneeId)
    : undefined;
  return owner ? `for ${owner.name}` : "with nobody assigned yet";
}

/** Passes on task creation's warning that an inactive person was skipped. */
function inactiveNotices(created: readonly string[]): string[] {
  return created.filter((notice) => notice.includes("is inactive"));
}

/**
 * Closes open invitations to a service once the person has come back: the
 * invitation worked. Recorded as completed with a note, so the history
 * shows what happened rather than a cancellation.
 */
function resolveInvitations(
  snapshot: ChurchSnapshot,
  personId: string,
  ctx: CommandContext,
): { snapshot: ChurchSnapshot; notices: string[] } {
  const invitations = snapshot.tasks.filter(
    (task) => task.personId === personId && task.type === "service_invitation" && isOpen(task),
  );
  if (!invitations.length) return { snapshot, notices: [] };

  const ids = new Set(invitations.map((task) => task.id));
  const next = patch(snapshot, {
    tasks: snapshot.tasks.map((task) =>
      ids.has(task.id)
        ? {
            ...task,
            status: "completed" as const,
            outcome: "other" as const,
            outcomeNote: "They came back.",
            completedAt: ctx.nowIso,
            completedBy: ctx.actorId,
          }
        : task,
    ),
  });
  const references = invitations.map((task) => task.reference).join(", ");
  return {
    snapshot: withActivity(
      next,
      ctx,
      invitations.map((task) =>
        activity(ctx, {
          type: "follow_up.completed",
          category: "follow_up",
          personId,
          summary: `${task.reference}: invitation to a service closed — they came back.`,
          meta: { taskId: task.id },
        }),
      ),
    ),
    notices: [`${references} closed: they came back.`],
  };
}

function ruleFor(
  snapshot: ChurchSnapshot,
  id: AutomationRuleId,
): AutomationRuleConfig | undefined {
  const rule = snapshot.settings.automationRules.find((entry) => entry.id === id);
  return rule?.enabled ? rule : undefined;
}

interface NextAction {
  type: FollowUpTaskType;
  note: string;
  inDays?: number;
}

/** The suggested next step after an outcome is recorded. */
export function nextActionFor(
  outcome: TaskOutcome,
  completedType: FollowUpTaskType,
): NextAction | null {
  switch (outcome) {
    case "contacted":
      return completedType === "welcome_message"
        ? {
            type: "service_invitation",
            note: "Invite them to the next service.",
            inDays: 5,
          }
        : null;
    case "no_answer":
      return {
        type: "phone_call",
        note: "Try again at a different time of day.",
        inDays: 2,
      };
    case "requested_another_time":
      return {
        type: "phone_call",
        note: "Call back at the time they asked for.",
        inDays: 3,
      };
    case "wrong_details":
    case "not_interested":
    case "needs_another_team":
    case "other":
    default:
      return null;
  }
}
