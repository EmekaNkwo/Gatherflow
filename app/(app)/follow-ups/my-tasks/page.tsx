"use client";

import { useMemo } from "react";
import { TasksView } from "@/components/follow-ups/tasks-view";
import type { TaskFilters } from "@/services/follow-ups/selectors";
import { useDemoRole } from "@/hooks/useDemoRole";

/** The work assigned to the signed-in demo user. */
export default function MyTasksPage() {
  const { teamMemberId, currentMember } = useDemoRole();
  const baseFilters = useMemo<TaskFilters>(
    () => ({ assigneeId: teamMemberId }),
    [teamMemberId],
  );

  return (
    <TasksView
      title="My tasks"
      description={`Follow-up work assigned to ${currentMember?.name ?? "you"}. Completing a task records an outcome, which decides what happens next.`}
      baseFilters={baseFilters}
      emptyTitle="Nothing is assigned to you"
      emptyDescription="When a coordinator assigns follow-up work to you, it appears here."
    />
  );
}
