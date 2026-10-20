import { toIsoDate } from "@/lib/dates";
import { foldForSearch, matchesPersonQuery } from "@/lib/person-search";
import { ratio } from "@/lib/metrics";
import type { IsoDate, PersonId, TeamMemberId } from "@/types/common";
import type { FollowUpTask, TaskStatus } from "@/types/follow-up";
import type { Ratio } from "@/types/common";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { VolunteerWorkload } from "@/types/team";
import { isOpen } from "./tasks";

/** A task joined to the person it concerns, ready for display. */
export interface TaskWithPerson {
  task: FollowUpTask;
  person?: Person;
  assigneeName?: string;
  /** Assigned to somebody who is no longer active, so nobody is doing it. */
  ownerInactive: boolean;
  overdue: boolean;
  dueToday: boolean;
}

export interface TaskFilters {
  status?: readonly TaskStatus[];
  assigneeId?: TeamMemberId | "unassigned";
  personId?: PersonId;
  type?: readonly FollowUpTask["type"][];
  priority?: readonly FollowUpTask["priority"][];
  /** A single task, for a deep link such as `?task=`. */
  taskId?: string;
  /** `overdue`, `today`, `upcoming` or `all`. */
  due?: "overdue" | "today" | "upcoming" | "all";
  search?: string;
}

export function isOverdue(task: FollowUpTask, today: IsoDate): boolean {
  return isOpen(task) && task.dueDate < today;
}

export function isDueToday(task: FollowUpTask, today: IsoDate): boolean {
  return isOpen(task) && task.dueDate === today;
}

/**
 * An open task nobody active is responsible for: never assigned, or assigned
 * to somebody since marked inactive. Both need a coordinator to pick an owner,
 * so both count as "no owner" in lists and on the dashboard.
 */
export function needsOwner(task: FollowUpTask, snapshot: Pick<ChurchSnapshot, "team">): boolean {
  if (!isOpen(task)) return false;
  if (!task.assigneeId) return true;
  const owner = snapshot.team.find((member) => member.id === task.assigneeId);
  return !owner?.active;
}

/** Whether every status asked for is a finished one (completed or cancelled). */
function onlyFinished(statuses: readonly TaskStatus[] | undefined): boolean {
  return Boolean(statuses?.length) && statuses!.every((status) => status === "completed" || status === "cancelled");
}

export function openTasks(snapshot: ChurchSnapshot): FollowUpTask[] {
  return snapshot.tasks.filter(isOpen);
}

export function overdueTasks(snapshot: ChurchSnapshot, now: Date): FollowUpTask[] {
  const today = toIsoDate(now);
  return snapshot.tasks.filter((task) => isOverdue(task, today));
}

export function tasksDueToday(snapshot: ChurchSnapshot, now: Date): FollowUpTask[] {
  const today = toIsoDate(now);
  return snapshot.tasks.filter((task) => isDueToday(task, today));
}

export function tasksForPerson(snapshot: ChurchSnapshot, personId: PersonId): FollowUpTask[] {
  return [...snapshot.tasks]
    .filter((task) => task.personId === personId)
    .sort((left, right) => (left.dueDate < right.dueDate ? 1 : -1));
}

/** Joins, filters and sorts tasks for the task tables and pipeline views. */
export function selectTasks(
  snapshot: ChurchSnapshot,
  filters: TaskFilters,
  now: Date,
): TaskWithPerson[] {
  const today = toIsoDate(now);
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
  const teamById = new Map(snapshot.team.map((member) => [member.id, member]));
  const finishedFirst = onlyFinished(filters.status);
  const search = filters.search?.trim() ?? "";

  return snapshot.tasks
    .filter((task) => {
      if (filters.status && !filters.status.includes(task.status)) return false;
      if (filters.type && !filters.type.includes(task.type)) return false;
      if (filters.priority && !filters.priority.includes(task.priority)) return false;
      if (filters.personId && task.personId !== filters.personId) return false;
      if (filters.taskId && task.id !== filters.taskId) return false;
      if (filters.assigneeId === "unassigned" && task.assigneeId && !needsOwner(task, snapshot)) {
        return false;
      }
      if (
        filters.assigneeId &&
        filters.assigneeId !== "unassigned" &&
        task.assigneeId !== filters.assigneeId
      ) {
        return false;
      }
      if (filters.due === "overdue" && !isOverdue(task, today)) return false;
      if (filters.due === "today" && !isDueToday(task, today)) return false;
      if (filters.due === "upcoming" && !(isOpen(task) && task.dueDate > today)) return false;

      if (search) {
        const person = peopleById.get(task.personId);
        const inTask = foldForSearch(`${task.reference} ${task.notes ?? ""}`).includes(foldForSearch(search));
        if (!inTask && !(person && matchesPersonQuery(person, search))) return false;
      }

      return true;
    })
    .map((task) => ({
      task,
      person: peopleById.get(task.personId),
      assigneeName: task.assigneeId ? teamById.get(task.assigneeId)?.name : undefined,
      ownerInactive: Boolean(task.assigneeId) && isOpen(task) && !teamById.get(task.assigneeId!)?.active,
      overdue: isOverdue(task, today),
      dueToday: isDueToday(task, today),
    }))
    .sort((left, right) => {
      // Finished work reads like a log: the most recently finished first.
      if (finishedFirst) {
        const leftAt = left.task.completedAt ?? left.task.dueDate;
        const rightAt = right.task.completedAt ?? right.task.dueDate;
        if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
      }
      if (left.task.dueDate !== right.task.dueDate) {
        return left.task.dueDate < right.task.dueDate ? -1 : 1;
      }
      const priorities = { urgent: 0, high: 1, normal: 2 } as const;
      return priorities[left.task.priority] - priorities[right.task.priority];
    });
}

/**
 * Completion rate. Counts only tasks that have reached a conclusion, and
 * reports on-time completion against its own denominator so the percentage
 * is never ambiguous.
 */
export function completionRate(
  snapshot: ChurchSnapshot,
  options: { from?: IsoDate; to?: IsoDate } = {},
): { completed: Ratio; onTime: Ratio } {
  const concluded = snapshot.tasks.filter((task) => {
    if (!["completed", "cancelled"].includes(task.status)) return false;
    const date = task.completedAt ? toIsoDate(task.completedAt) : task.dueDate;
    if (options.from && date < options.from) return false;
    if (options.to && date > options.to) return false;
    return true;
  });

  const completed = concluded.filter((task) => task.status === "completed");
  const onTime = completed.filter(
    (task) => task.completedAt && toIsoDate(task.completedAt) <= task.dueDate,
  );

  return {
    completed: ratio(completed.length, concluded.length),
    onTime: ratio(onTime.length, completed.length),
  };
}

/** Per-volunteer workload, used by the team view to balance follow-up work. */
export function volunteerWorkloads(snapshot: ChurchSnapshot, now: Date): VolunteerWorkload[] {
  const today = toIsoDate(now);

  return snapshot.team
    .map((member) => {
      const assigned = snapshot.tasks.filter((task) => task.assigneeId === member.id);
      const completed = assigned.filter((task) => task.status === "completed");
      return {
        member,
        assigned: assigned.filter(isOpen).length,
        dueToday: assigned.filter((task) => isDueToday(task, today)).length,
        overdue: assigned.filter((task) => isOverdue(task, today)).length,
        completed: completed.length,
        completedOnTime: completed.filter(
          (task) => task.completedAt && toIsoDate(task.completedAt) <= task.dueDate,
        ).length,
      };
    })
    .sort((left, right) => right.assigned - left.assigned);
}
