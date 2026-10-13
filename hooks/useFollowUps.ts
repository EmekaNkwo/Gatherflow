"use client";

import { useCallback, useMemo } from "react";
import { taskScope } from "@/lib/permissions";
import type { IsoDate, PersonId, TaskId, TeamMemberId } from "@/types/common";
import type { TaskOutcome } from "@/types/follow-up";
import { completeTask } from "@/services/follow-ups/completion";
import {
  completionRate,
  selectTasks,
  volunteerWorkloads,
  type TaskFilters,
} from "@/services/follow-ups/selectors";
import {
  assignTask,
  cancelTask,
  createFollowUpTask,
  rescheduleTask,
  startTask,
  type CreateTaskInput,
} from "@/services/follow-ups/tasks";
import { useSessionStore } from "@/stores/session-store";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/**
 * Follow-up tasks.
 *
 * The task list is scoped by the active demo role: volunteers only ever see
 * their own work, coordinators and administrators see everything.
 */
export function useFollowUps(filters: TaskFilters = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { run } = useCommand();
  const role = useSessionStore((state) => state.role);
  const teamMemberId = useSessionStore((state) => state.teamMemberId);

  const scope = taskScope(role);

  const scopedFilters = useMemo<TaskFilters>(() => {
    if (scope === "own") return { ...filters, assigneeId: teamMemberId };
    return filters;
  }, [filters, scope, teamMemberId]);

  const tasks = useMemo(
    () => (scope === "none" ? [] : selectTasks(snapshot, scopedFilters, now)),
    [snapshot, scopedFilters, now, scope],
  );

  const counts = useMemo(() => {
    const all = scope === "none" ? [] : selectTasks(snapshot, scope === "own" ? { assigneeId: teamMemberId } : {}, now);
    return {
      open: all.filter((entry) =>
        ["pending", "in_progress", "rescheduled"].includes(entry.task.status),
      ).length,
      dueToday: all.filter((entry) => entry.dueToday).length,
      overdue: all.filter((entry) => entry.overdue).length,
      unassigned: all.filter(
        (entry) =>
          !entry.task.assigneeId &&
          ["pending", "in_progress", "rescheduled"].includes(entry.task.status),
      ).length,
      completed: all.filter((entry) => entry.task.status === "completed").length,
    };
  }, [snapshot, now, scope, teamMemberId]);

  const rates = useMemo(() => completionRate(snapshot), [snapshot]);
  const workloads = useMemo(() => volunteerWorkloads(snapshot, now), [snapshot, now]);

  const create = useCallback(
    (input: CreateTaskInput) =>
      run((snap, ctx) => createFollowUpTask(snap, input, ctx), { undoLabel: "task creation" }),
    [run],
  );

  const complete = useCallback(
    (taskId: TaskId, outcome: TaskOutcome, outcomeNote?: string) =>
      run((snap, ctx) => completeTask(snap, { taskId, outcome, outcomeNote }, ctx), {
        undoLabel: "completing the task",
      }),
    [run],
  );

  const reschedule = useCallback(
    (taskId: TaskId, dueDate: IsoDate, reason?: string) =>
      run((snap, ctx) => rescheduleTask(snap, taskId, dueDate, reason, ctx), {
        undoLabel: "rescheduling",
      }),
    [run],
  );

  const assign = useCallback(
    (taskId: TaskId, assigneeId: TeamMemberId | undefined) =>
      run((snap, ctx) => assignTask(snap, taskId, assigneeId, ctx)),
    [run],
  );

  const start = useCallback(
    (taskId: TaskId) => run((snap) => startTask(snap, taskId), { silent: true }),
    [run],
  );

  const cancel = useCallback(
    (taskId: TaskId, reason?: string) =>
      run((snap, ctx) => cancelTask(snap, taskId, reason, ctx), { undoLabel: "cancelling the task" }),
    [run],
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
