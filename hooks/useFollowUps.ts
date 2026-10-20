"use client";

import { useCallback, useMemo } from "react";
import { taskScope } from "@/lib/permissions";
import type { IsoDate, PersonId, TaskId, TeamMemberId } from "@/types/common";
import type { TaskOutcome } from "@/types/follow-up";
import {
  completionRate,
  needsOwner,
  selectTasks,
  volunteerWorkloads,
  type TaskFilters,
} from "@/services/follow-ups/selectors";
import { type CreateTaskInput } from "@/services/follow-ups/tasks";
import { canBeContacted } from "@/services/follow-ups/contact";
import type { TaskActionGate } from "@/components/follow-ups/task-list";
import { toIsoDate } from "@/lib/dates";
import { useSessionStore } from "@/stores/session-store";
import { useRole } from "./useRole";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/**
 * Follow-up tasks.
 *
 * The task list is scoped by the signed-in role: volunteers only ever see
 * their own work, coordinators and administrators see everything.
 */
export function useFollowUps(filters: TaskFilters = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { dispatch } = useCommand();
  const role = useSessionStore((state) => state.role);
  const teamMemberId = useSessionStore((state) => state.teamMemberId);

  const scope = taskScope(role);

  const scopedFilters = useMemo<TaskFilters>(() => {
    if (scope === "own") return { ...filters, assigneeId: teamMemberId ?? undefined };
    return filters;
  }, [filters, scope, teamMemberId]);

  const tasks = useMemo(
    () => (scope === "none" ? [] : selectTasks(snapshot, scopedFilters, now)),
    [snapshot, scopedFilters, now, scope],
  );

  const counts = useMemo(() => {
    const all =
      scope === "none"
        ? []
        : selectTasks(snapshot, scope === "own" ? { assigneeId: teamMemberId ?? undefined } : {}, now);
    return {
      open: all.filter((entry) =>
        ["pending", "in_progress", "rescheduled"].includes(entry.task.status),
      ).length,
      dueToday: all.filter((entry) => entry.dueToday).length,
      overdue: all.filter((entry) => entry.overdue).length,
      // Open work with nobody active responsible, the same as the dashboard.
      unassigned: all.filter((entry) => needsOwner(entry.task, snapshot)).length,
      completed: all.filter((entry) => entry.task.status === "completed").length,
    };
  }, [snapshot, now, scope, teamMemberId]);

  const rates = useMemo(() => completionRate(snapshot), [snapshot]);
  const workloads = useMemo(() => volunteerWorkloads(snapshot, now), [snapshot, now]);

  const create = useCallback(
    (input: CreateTaskInput) =>
      dispatch("task.create", input, { undoLabel: "task creation" }),
    [dispatch],
  );

  const complete = useCallback(
    (taskId: TaskId, outcome: TaskOutcome, outcomeNote?: string) =>
      dispatch(
        "task.complete",
        { taskId, outcome, outcomeNote },
        { undoLabel: "completing the task" },
      ),
    [dispatch],
  );

  const reschedule = useCallback(
    (taskId: TaskId, dueDate: IsoDate, reason?: string) =>
      dispatch("task.reschedule", { taskId, dueDate, reason }, { undoLabel: "rescheduling" }),
    [dispatch],
  );

  const assign = useCallback(
    (taskId: TaskId, assigneeId: TeamMemberId | undefined) =>
      dispatch("task.assign", { taskId, assigneeId }),
    [dispatch],
  );

  const start = useCallback(
    (taskId: TaskId) => dispatch("task.start", { taskId }, { silent: true }),
    [dispatch],
  );

  const cancel = useCallback(
    (taskId: TaskId, reason?: string) =>
      dispatch("task.cancel", { taskId, reason }, { undoLabel: "cancelling the task" }),
    [dispatch],
  );

  return {
    tasks,
    counts,
    rates,
    workloads,
    scope,
    create,
    complete,
    reschedule,
    assign,
    start,
    cancel,
  };
}

/** Tasks for one person, for profile pages. */
export function usePersonTasks(personId: PersonId) {
  const snapshot = useSnapshot();
  const now = useNow();
  return useMemo(() => selectTasks(snapshot, { personId }, now), [snapshot, personId, now]);
}

/**
 * Which follow-up actions to offer for a given task: the command each one
 * dispatches, checked with `canRun`, so a volunteer is never shown a button
 * for somebody else's work that the server would refuse.
 */
export function useTaskActionGate(): TaskActionGate {
  const { can, canRun } = useRole();
  const now = useNow();
  const today = toIsoDate(now);

  return useCallback<TaskActionGate>(
    (action, entry) => {
      const taskId = entry.task.id;
      switch (action) {
        case "complete":
          return canRun("task.complete", { taskId, outcome: "contacted" });
        case "reschedule":
          return canRun("task.reschedule", { taskId, dueDate: today });
        case "assign":
          return canRun("task.assign", { taskId });
        case "cancel":
          return canRun("task.cancel", { taskId });
        case "message":
          return Boolean(entry.person && canBeContacted(entry.person)) && can("communications.write");
        default:
          return false;
      }
    },
    [can, canRun, today],
  );
}
