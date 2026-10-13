import { formatDisplayDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { ActivityEvent } from "@/types/activity";
import type { AttendanceRecord, AttendanceSession } from "@/types/attendance";
import type { CareRecord } from "@/types/care";
import type { CommunicationLogEntry } from "@/types/communication";
import {
  COMMUNICATION_STATUS_LABELS,
  type CommunicationStatus,
} from "@/types/communication";
import type { FollowUpTask } from "@/types/follow-up";
import { FOLLOW_UP_TASK_TYPE_LABELS, TASK_OUTCOME_LABELS } from "@/types/follow-up";
import type { Group } from "@/types/group";
import type { Person } from "@/types/person";
import { CLOSURE_REASON_LABELS, VISITOR_SOURCE_LABELS } from "@/types/person";
import { at, type SeedContext } from "./context";
import { TEAM_IDS } from "./team";

interface ActivityInput {
  people: readonly Person[];
  tasks: readonly FollowUpTask[];
  sessions: readonly AttendanceSession[];
  attendance: readonly AttendanceRecord[];
  groups: readonly Group[];
  careRecords: readonly CareRecord[];
  communications: readonly CommunicationLogEntry[];
}

/**
 * Derives the timeline from the seeded records, so every entry in the
 * activity feed corresponds to something that is actually in the data.
 *
 * Attendance is summarised per session rather than per person: individual
 * attendance histories belong on the person's own profile, not on a shared
 * dashboard feed.
 */
export function createActivity(ctx: SeedContext, input: ActivityInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const byId = new Map(input.people.map((person) => [person.id, person]));

  const add = (event: Omit<ActivityEvent, "id">) => {
    events.push({ ...event, id: ctx.id("activity") });
  };

  for (const person of input.people) {
    const name = displayName(person);

    if (person.visitor) {
      add({
        type: "visitor.registered",
        category: "visitor",
        personId: person.id,
        actorId: TEAM_IDS.volunteerAmara,
        summary: `${name} registered as a first-time visitor (${VISITOR_SOURCE_LABELS[person.visitor.source]}).`,
        at: at(person.visitor.firstVisitDate, 12),
        visibility: "general",
      });

      if (person.visitor.assignedTo) {
        add({
          type: "visitor.assigned",
          category: "visitor",
          personId: person.id,
          actorId: TEAM_IDS.coordinator,
          summary: `${name} was assigned to a follow-up volunteer.`,
          at: at(person.visitor.firstVisitDate, 13),
          visibility: "general",
        });
      }

      if (person.visitor.membershipInterestAt) {
        add({
          type: "visitor.membership_interest",
          category: "visitor",
          personId: person.id,
          summary: `${name} asked about becoming a member.`,
          at: person.visitor.membershipInterestAt,
          visibility: "general",
        });
      }

      if (person.visitor.closure) {
        add({
          type: "visitor.closed",
          category: "visitor",
          personId: person.id,
          actorId: TEAM_IDS.coordinator,
          summary: `Follow-up for ${name} was closed — ${CLOSURE_REASON_LABELS[
            person.visitor.closure.reason
          ].toLowerCase()}.`,
          at: person.visitor.closure.recordedAt,
          visibility: "general",
        });
      }

      if (person.contact.optedOut && person.contact.optedOutAt) {
        add({
          type: "visitor.contact_preference_changed",
          category: "visitor",
          personId: person.id,
          summary: `${name} asked not to be contacted again. No further follow-up will be created.`,
          at: person.contact.optedOutAt,
          visibility: "general",
        });
      }
    }

    if (person.member) {
      for (const change of person.member.statusHistory) {
        add({
          type:
            change.status === "new_member" ? "membership.registered" : "membership.status_changed",
          category: "membership",
          personId: person.id,
          actorId: change.changedBy,
          summary:
            change.status === "new_member"
              ? `${name} was registered as a member (${person.member.reference}).`
              : `${name}'s membership status changed to ${change.status.replace("_", " ")}.`,
          at: change.changedAt,
          visibility: "general",
          meta: change.reason ? { reason: change.reason } : undefined,
        });
      }
    }
  }

  for (const group of input.groups) {
    add({
      type: "group.created",
      category: "group",
      actorId: TEAM_IDS.admin,
      summary: `${group.name} was created.`,
      at: group.createdAt,
      visibility: "general",
      meta: { groupId: group.id },
    });

    for (const membership of group.members) {
      const person = byId.get(membership.personId);
      if (!person) continue;
      add({
        type: "group.joined",
        category: "group",
        personId: person.id,
        actorId: membership.addedBy,
        summary: `${displayName(person)} joined ${group.name}.`,
        at: membership.joinedAt,
        visibility: "general",
        meta: { groupId: group.id },
      });
    }
  }

  for (const task of input.tasks) {
    const person = byId.get(task.personId);
    if (!person) continue;
    const label = FOLLOW_UP_TASK_TYPE_LABELS[task.type].toLowerCase();

    add({
      type: "follow_up.created",
      category: "follow_up",
      personId: person.id,
      actorId: task.createdBy,
      summary: `${task.reference}: ${label} created for ${displayName(person)}.`,
      at: task.createdAt,
      visibility: "general",
      meta: { taskId: task.id },
    });

    if (task.status === "completed" && task.completedAt) {
      add({
        type: "follow_up.completed",
        category: "follow_up",
        personId: person.id,
        actorId: task.completedBy,
        summary: `${task.reference}: ${label} completed — ${
          task.outcome ? TASK_OUTCOME_LABELS[task.outcome].toLowerCase() : "no outcome recorded"
        }.`,
        at: task.completedAt,
        visibility: "general",
        meta: { taskId: task.id },
      });
    }

    for (const entry of task.rescheduleHistory) {
      add({
        type: "follow_up.rescheduled",
        category: "follow_up",
        personId: person.id,
        actorId: entry.by,
        summary: `${task.reference} moved from ${formatDisplayDate(entry.from)} to ${formatDisplayDate(entry.to)}.`,
        at: entry.at,
        visibility: "general",
        meta: { taskId: task.id },
      });
    }
  }

  for (const session of input.sessions) {
    const present = input.attendance.filter(
      (row) => row.sessionId === session.id && row.status === "present",
    );
    if (!present.length) continue;
    const firstTimers = present.filter((row) => row.firstVisit).length;
    add({
      type: "attendance.recorded",
      category: "attendance",
      actorId: TEAM_IDS.volunteerAmara,
      summary: `${present.length} people recorded at ${session.name} on ${formatDisplayDate(session.date)}${
        firstTimers ? `, including ${firstTimers} first-time visitor${firstTimers === 1 ? "" : "s"}` : ""
      }.`,
      at: at(session.date, 12),
      visibility: "general",
      meta: { sessionId: session.id },
    });
  }

  for (const entry of input.communications) {
    const person = byId.get(entry.personId);
    if (!person) continue;
    add({
      type: "communication.logged",
      category: "communication",
      personId: person.id,
      actorId: entry.actorId,
      summary: `Simulated message to ${displayName(person)} — ${COMMUNICATION_STATUS_LABELS[
        entry.status as CommunicationStatus
      ].toLowerCase()}.`,
      at: entry.at,
      visibility: "general",
    });
  }

  for (const record of input.careRecords) {
    // Care activity is restricted: it never appears in the general feed.
    add({
      type: "care.created",
      category: "care",
      personId: record.personId,
      actorId: TEAM_IDS.careLead,
      summary: `Pastoral-care record ${record.reference} opened.`,
      at: record.createdAt,
      visibility: "restricted",
      meta: { careRecordId: record.id },
    });
  }

  add({
    type: "system.seeded",
    category: "system",
    summary: "Demo data generated. All records are synthetic.",
    at: at(ctx.today, 7),
    visibility: "general",
  });

  return events.sort((left, right) => (left.at < right.at ? 1 : -1));
}
