"use client";

import { useMemo } from "react";
import { TasksView } from "@/components/follow-ups/tasks-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageShell } from "@/components/shared/page-header";
import type { TaskFilters } from "@/services/follow-ups/selectors";
import { useRole } from "@/hooks/useRole";

/** The work assigned to the signed-in person. */
export default function MyTasksPage() {
  const { teamMemberId } = useRole();
  const baseFilters = useMemo<TaskFilters>(
    () => ({ assigneeId: teamMemberId ?? undefined }),
    [teamMemberId],
  );

  if (!teamMemberId) {
    return (
      <PageShell>
        <EmptyState
          title="Nothing is given to you"
          description="Your account isn't linked to a team member in this church, so no follow-ups can be given to you yet."
        />
      </PageShell>
    );
  }

  return (
    <TasksView
      title="My follow-ups"
      description="The people you've been asked to reach."
      baseFilters={baseFilters}
      layout="cards"
      emptyTitle="Nobody to reach right now"
      emptyDescription="When somebody is given to you to follow up, they appear here."
    />
  );
}
