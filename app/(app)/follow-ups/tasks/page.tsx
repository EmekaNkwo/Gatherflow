"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TasksView } from "@/components/follow-ups/tasks-view";
import type { TaskFilters } from "@/services/follow-ups/selectors";
import { TASK_STATUSES } from "@/types/follow-up";
import { useFollowUps } from "@/hooks/useFollowUps";

/**
 * Every follow-up task. Dashboard metrics link straight here with the same
 * filter they were counted with, so a number and its list always agree.
 *
 * `?task=` (from search) narrows the list to that one follow-up, whatever
 * state it is in, with a way back to everything.
 */
export default function AllTasksPage() {
  const params = useSearchParams();
  const due = params.get("due");
  const assignee = params.get("assignee");
  const taskId = params.get("task");
  // Volunteers only ever see their own work, so the title says so.
  const { scope } = useFollowUps();

  const baseFilters = useMemo<TaskFilters>(
    () =>
      taskId
        ? { taskId, status: TASK_STATUSES }
        : {
            due: due === "overdue" || due === "today" || due === "upcoming" ? due : undefined,
            assigneeId: assignee === "unassigned" ? "unassigned" : (assignee ?? undefined),
          },
    [due, assignee, taskId],
  );

  const own = scope === "own";

  return (
    <TasksView
      title={own ? "Your follow-ups" : "Everyone's follow-ups"}
      description={
        own ? "The people you've been asked to reach." : "Who the church is reaching out to, and who is doing it."
      }
      baseFilters={baseFilters}
      lockDue={Boolean(baseFilters.due) || Boolean(taskId)}
      notice={
        taskId ? (
          <p className="text-sm text-muted-foreground">
            Showing one follow-up.{" "}
            <Link href="/follow-ups/tasks" className="font-medium text-primary underline-offset-4 hover:underline">
              Show all
            </Link>
          </p>
        ) : null
      }
      emptyTitle={taskId ? "That follow-up isn't here" : "No follow-ups yet"}
      emptyDescription={
        taskId
          ? "It may have been removed, or it belongs to someone else's list."
          : "They appear when a visitor is registered, when somebody comes back, or when you add one."
      }
    />
  );
}
