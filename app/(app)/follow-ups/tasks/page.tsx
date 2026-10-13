"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { TasksView } from "@/components/follow-ups/tasks-view";
import type { TaskFilters } from "@/services/follow-ups/selectors";

/**
 * Every follow-up task. Dashboard metrics link straight here with the same
 * filter they were counted with, so a number and its list always agree.
 */
export default function AllTasksPage() {
  const params = useSearchParams();
  const due = params.get("due");
  const assignee = params.get("assignee");

  const baseFilters = useMemo<TaskFilters>(
    () => ({
      due: due === "overdue" || due === "today" || due === "upcoming" ? due : undefined,
      assigneeId: assignee === "unassigned" ? "unassigned" : (assignee ?? undefined),
    }),
    [due, assignee],
  );

  return (
    <TasksView
      title="Follow-up tasks"
      description="Every task the active demo role is allowed to see. Volunteers see only their own."
      baseFilters={baseFilters}
      lockDue={Boolean(baseFilters.due)}
      emptyTitle="No follow-up tasks yet"
      emptyDescription="Tasks appear here when a visitor is registered, when someone returns, or when you create one."
    />
  );
}
