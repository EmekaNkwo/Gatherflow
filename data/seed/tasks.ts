import { addDaysIso } from "@/lib/dates";
import { nextReference } from "@/lib/ids";
import type { IsoDate } from "@/types/common";
import type {
  FollowUpTask,
  FollowUpTaskType,
  TaskOutcome,
  TaskPriority,
  TaskStatus,
} from "@/types/follow-up";
import type { Person } from "@/types/person";
import { at, type SeedContext } from "./context";
import type { VisitorPlan } from "./people";
import { TEAM_IDS } from "./team";

interface TaskDraft {
  personId: string;
  type: FollowUpTaskType;
  assigneeId?: string;
  dueDate: IsoDate;
  status: TaskStatus;
  priority?: TaskPriority;
  outcome?: TaskOutcome;
  outcomeNote?: string;
  notes?: string;
  completedOffset?: number;
  origin?: FollowUpTask["origin"];
  automationKey?: string;
  rescheduledFrom?: IsoDate;
}

/**
 * Seeded follow-up work. The mix is deliberate: tasks due today, a handful
 * of overdue ones, unassigned visitors awaiting a volunteer, and closed
 * records that correctly have no open tasks at all.
 */
export function createTasks(
  ctx: SeedContext,
  people: readonly Person[],
  visitorPlans: readonly VisitorPlan[],
): FollowUpTask[] {
  const drafts: TaskDraft[] = [];
  const byId = new Map(people.map((person) => [person.id, person]));

  visitorPlans.forEach((plan, index) => {
    const person = byId.get(plan.personId);
    if (!person?.visitor) return;
    const firstVisit = person.visitor.firstVisitDate;
    const assignee = plan.assignedTo;

    switch (plan.stageId) {
      case "new_visitor": {
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "pending",
          priority: assignee ? "normal" : "high",
          notes: assignee
            ? "Send the first-time visitor welcome message."
            : "Awaiting assignment to a follow-up volunteer.",
          origin: "rule:first_visit_welcome",
          automationKey: `first_visit_welcome:${plan.personId}:${firstVisit}`,
        });
        break;
      }
      case "contact_pending": {
        const dueToday = index % 2 === 0;
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: dueToday ? ctx.today : addDaysIso(firstVisit, 2),
          status: "pending",
          priority: dueToday ? "high" : "urgent",
          notes: dueToday
            ? "Welcome message still to send."
            : "First contact not yet recorded.",
          origin: "rule:first_visit_welcome",
          automationKey: `first_visit_welcome:${plan.personId}:${firstVisit}`,
        });
        break;
      }
      case "contact_attempted": {
        drafts.push({
          personId: plan.personId,
          type: "phone_call",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: "no_answer",
          outcomeNote: "Called twice, no answer. Will try an evening instead.",
          completedOffset: 3,
        });
        drafts.push({
          personId: plan.personId,
          type: "phone_call",
          assigneeId: assignee,
          dueDate: ctx.today,
          // Rescheduled tasks stay open — the status records that the date
          // moved, it does not close the task.
          status: "rescheduled",
          priority: "high",
          notes: "Second attempt, agreed for an evening.",
          rescheduledFrom: addDaysIso(firstVisit, 4),
        });
        break;
      }
      case "contacted": {
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: "contacted",
          outcomeNote: "Spoke on the phone, very positive.",
          completedOffset: 2,
        });
        drafts.push({
          personId: plan.personId,
          type: "service_invitation",
          assigneeId: assignee,
          dueDate: addDaysIso(ctx.today, 2),
          status: "pending",
          notes: "Invite to this Sunday's service.",
        });
        break;
      }
      case "invited_to_return": {
        drafts.push({
          personId: plan.personId,
          type: "phone_call",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: "contacted",
          completedOffset: 2,
        });
        drafts.push({
          personId: plan.personId,
          type: "check_in",
          assigneeId: assignee,
          // Deliberately overdue so the dashboard always has real alerts.
          dueDate: addDaysIso(ctx.today, -4),
          status: "pending",
          priority: "high",
          notes: "Check in after the invitation.",
        });
        break;
      }
      case "returned": {
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: "contacted",
          completedOffset: 1,
        });
        drafts.push({
          personId: plan.personId,
          type: "check_in",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 10),
          status: "completed",
          outcome: "contacted",
          outcomeNote: "Came back the following month and brought a friend.",
          completedOffset: 11,
        });
        drafts.push({
          personId: plan.personId,
          type: "group_invitation",
          assigneeId: assignee,
          dueDate: addDaysIso(ctx.today, 4),
          status: "pending",
          notes: "Invite to the Riverside connect group.",
        });
        break;
      }
      case "membership_orientation": {
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: "contacted",
          completedOffset: 2,
        });
        drafts.push({
          personId: plan.personId,
          type: "membership_orientation",
          assigneeId: TEAM_IDS.admin,
          dueDate: addDaysIso(ctx.today, 3),
          status: "pending",
          priority: "high",
          notes: "Booked onto the next orientation session.",
          origin: "rule:membership_orientation",
          automationKey: `membership_orientation:${plan.personId}`,
        });
        break;
      }
      case "closed": {
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: plan.closure === "contact_declined" ? "not_interested" : "no_answer",
          outcomeNote:
            plan.closure === "contact_declined"
              ? "Asked not to be contacted again. Recorded as an opt-out."
              : "Third attempt with no response. Closed as agreed.",
          completedOffset: 3,
        });
        // No open tasks: follow-up has stopped for these records.
        break;
      }
      case "connected": {
        drafts.push({
          personId: plan.personId,
          type: "welcome_message",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 2),
          status: "completed",
          outcome: "contacted",
          completedOffset: 1,
        });
        drafts.push({
          personId: plan.personId,
          type: "membership_orientation",
          assigneeId: TEAM_IDS.admin,
          dueDate: addDaysIso(firstVisit, 21),
          status: "completed",
          outcome: "contacted",
          outcomeNote: "Attended orientation and joined as a member.",
          completedOffset: 21,
        });
        drafts.push({
          personId: plan.personId,
          type: "group_invitation",
          assigneeId: assignee,
          dueDate: addDaysIso(firstVisit, 28),
          status: "completed",
          outcome: "contacted",
          outcomeNote: "Joined a connect group.",
          completedOffset: 30,
        });
        break;
      }
      default:
        break;
    }
  });

  // Member-facing work: two members asked to be contacted, and one pastoral
  // check-in has been left too long.
  const requested = people.filter((person) => person.member?.requestedContact);
  requested.forEach((person, index) => {
    drafts.push({
      personId: person.id,
      type: "check_in",
      assigneeId: index === 0 ? TEAM_IDS.coordinator : TEAM_IDS.volunteerTunde,
      dueDate: index === 0 ? ctx.today : addDaysIso(ctx.today, -2),
      status: "pending",
      priority: index === 0 ? "normal" : "high",
      notes: "Member asked someone to get in touch.",
    });
  });

  const inactiveMembers = people.filter((person) => person.member?.status === "inactive");
  inactiveMembers.slice(0, 2).forEach((person, index) => {
    drafts.push({
      personId: person.id,
      type: "pastoral_contact",
      assigneeId: TEAM_IDS.careLead,
      dueDate: addDaysIso(ctx.today, index === 0 ? -6 : 5),
      status: "pending",
      priority: index === 0 ? "urgent" : "normal",
      notes: "No attendance recorded for over eight weeks — check how they are.",
    });
  });

  // A short history of completed work so the completion-rate metric has a
  // meaningful denominator, including a few completed after the due date.
  const activeMembers = people.filter((person) => person.member?.status === "active").slice(0, 14);
  activeMembers.forEach((person, index) => {
    const dueDate = addDaysIso(ctx.today, -(7 + index * 2));
    drafts.push({
      personId: person.id,
      type: index % 3 === 0 ? "post_event_follow_up" : "check_in",
      assigneeId: index % 2 === 0 ? TEAM_IDS.volunteerAmara : TEAM_IDS.volunteerTunde,
      dueDate,
      status: "completed",
      outcome: index % 5 === 0 ? "requested_another_time" : "contacted",
      completedOffset: index % 4 === 0 ? 3 : 0,
      notes: "Routine check-in after the outreach day.",
    });
  });

  // One cancelled task, so the status filter has something to show.
  const cancelledFor = people.find((person) => person.contact.optedOut);
  if (cancelledFor) {
    drafts.push({
      personId: cancelledFor.id,
      type: "check_in",
      assigneeId: TEAM_IDS.volunteerTunde,
      dueDate: addDaysIso(ctx.today, -8),
      status: "cancelled",
      notes: "Cancelled after the visitor asked not to be contacted again.",
    });
  }

  const references: string[] = [];
  return drafts.map((draft) => {
    const reference = nextReference("FU", references);
    references.push(reference);
    const createdOn = draft.rescheduledFrom ?? addDaysIso(draft.dueDate, -2);
    const completedDate =
      draft.status === "completed"
        ? addDaysIso(createdOn, draft.completedOffset ?? 1)
        : undefined;

    return {
      id: ctx.id("task"),
      reference,
      personId: draft.personId,
      type: draft.type,
      assigneeId: draft.assigneeId,
      priority: draft.priority ?? "normal",
      dueDate: draft.dueDate,
      status: draft.status,
      notes: draft.notes,
      outcome: draft.outcome,
      outcomeNote: draft.outcomeNote,
      origin: draft.origin ?? "manual",
      automationKey: draft.automationKey,
      rescheduleHistory: draft.rescheduledFrom
        ? [
            {
              from: draft.rescheduledFrom,
              to: draft.dueDate,
              at: at(draft.rescheduledFrom, 17),
              by: draft.assigneeId ?? TEAM_IDS.coordinator,
              reason: "Visitor asked for an evening call.",
            },
          ]
        : [],
      createdAt: at(createdOn, 9),
      createdBy: draft.origin && draft.origin !== "manual" ? TEAM_IDS.admin : TEAM_IDS.coordinator,
      completedAt: completedDate ? at(completedDate, 16) : undefined,
      completedBy: completedDate ? (draft.assigneeId ?? TEAM_IDS.coordinator) : undefined,
    } satisfies FollowUpTask;
  });
}
