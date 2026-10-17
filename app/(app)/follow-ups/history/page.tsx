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
      title="Finished follow-ups"
      description="What has been done, and how each conversation ended."
      baseFilters={baseFilters}
      lockDue
      emptyTitle="No completed follow-ups yet"
      emptyDescription="Once tasks are completed or cancelled they are listed here with their outcome."
    />
  );
}
