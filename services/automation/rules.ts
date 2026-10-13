import { addDaysIso } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { FollowUpTaskType, TaskOutcome } from "@/types/follow-up";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { AutomationRuleConfig, AutomationRuleId } from "@/types/settings";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";
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

        const outcome = createFollowUpTask(
          current,
          {
            personId: event.personId,
            type: "welcome_message",
            assigneeId: person.visitor?.assignedTo ?? rule.defaultAssigneeId,
            dueDate: addDaysIso(ctx.today, rule.dueInDays),
            priority: person.visitor?.assignedTo ? "normal" : "high",
            notes: "Send the first-time visitor welcome message.",
            origin: "rule:first_visit_welcome",
            automationKey: `first_visit_welcome:${event.personId}:${event.firstVisitDate}`,
          },
          ctx,
        );

        if (outcome.ok) {
          current = outcome.value.snapshot;
          notices.push(
            `Welcome follow-up created${person.visitor?.assignedTo ? "" : " for the follow-up team"}, due ${addDaysIso(ctx.today, rule.dueInDays)}.`,
          );
        } else if (outcome.code === "opted_out") {
          notices.push(outcome.error);
        }
        break;
      }

      case "visitor.returned": {
        const rule = ruleFor(current, "return_visit_review");
        if (!rule) break;
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

        if (stopped.has(event.personId) || person.visitor.closure) break;
        if (isTerminalStage(current.settings, person.visitor.stageId)) break;

        const hasOpenWork = current.tasks.some(
          (task) => task.personId === person.id && isOpen(task),
        );
        if (hasOpenWork) break;

        const outcome = createFollowUpTask(
          current,
          {
            personId: person.id,
            type: "check_in",
            assigneeId: person.visitor.assignedTo ?? rule.defaultAssigneeId,
            dueDate: addDaysIso(ctx.today, rule.dueInDays),
            notes: `Returned for visit ${event.visitCount} — ask how they are finding things.`,
            origin: "rule:return_visit_review",
            automationKey: `return_visit_review:${person.id}:${event.visitCount}`,
          },
          ctx,
        );
        if (outcome.ok) {
          current = outcome.value.snapshot;
          notices.push("A check-in follow-up was created for the return visit.");
        }
        break;
      }

      case "visitor.membership_interest": {
        const rule = ruleFor(current, "membership_orientation");
        if (!rule || stopped.has(event.personId)) break;

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
            automationKey: `membership_orientation:${event.personId}`,
          },
          ctx,
        );
        if (outcome.ok) {
          current = outcome.value.snapshot;
          notices.push("A membership orientation task was created.");
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
            automationKey: `next_action:${task.id}`,
          },
          ctx,
        );
        if (outcome.ok) {
          current = outcome.value.snapshot;
          notices.push(`Next action created: ${next.note}`);
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
