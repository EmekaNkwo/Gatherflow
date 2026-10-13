"use client";

import { useMemo } from "react";
import { TasksView } from "@/components/follow-ups/tasks-view";
import type { TaskFilters } from "@/services/follow-ups/selectors";

/** Completed and cancelled follow-up work, with the outcome recorded. */
export default function FollowUpHistoryPage() {
  const baseFilters = useMemo<TaskFilters>(
    () => ({ status: ["completed", "cancelled"] }),
    [],
  );

  return (
    <TasksView
      title="Follow-up history"
      description="What has already been done, and how each conversation ended. Cancelled tasks are kept so the reason stays visible."
      baseFilters={baseFilters}
      lockDue
      emptyTitle="No completed follow-ups yet"
      emptyDescription="Once tasks are completed or cancelled they are listed here with their outcome."
    />
  );
}
