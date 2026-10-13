"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, NoResultsState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/metric-card";
import { MessageComposer } from "@/components/communications/message-composer";
import { CompleteTaskDialog } from "./complete-task-dialog";
import { CreateTaskDialog, type NewTaskValues } from "./create-task-dialog";
import { RescheduleDialog } from "./reschedule-dialog";
import { TaskTable } from "./task-table";
import { AssignDialog } from "@/components/visitors/visitor-dialogs";
import { toIsoDate } from "@/lib/dates";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type FollowUpTaskType,
  type TaskStatus,
} from "@/types/follow-up";
import type { TaskFilters, TaskWithPerson } from "@/services/follow-ups/selectors";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";

interface TasksViewProps {
  title: string;
  description: string;
  /** Filters applied on top of whatever the role is allowed to see. */
  baseFilters?: TaskFilters;
  /** Hides the due-window filter on views that are already scoped by it. */
  lockDue?: boolean;
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * The shared task view behind "all tasks", "my tasks", "due today",
 * "overdue" and "completed", so every one of them filters, sorts and acts
 * the same way.
 */
export function TasksView({
  title,
  description,
  baseFilters = {},
  lockDue = false,
  emptyTitle,
  emptyDescription,
}: TasksViewProps) {
  const now = useNow();
  const today = toIsoDate(now);
  const snapshot = useSnapshot();
  const { assignableTeam, can, teamMemberId } = useDemoRole();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [type, setType] = useState<FollowUpTaskType | "">("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState<NonNullable<TaskFilters["due"]>>(baseFilters.due ?? "all");

  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);
  const [assigning, setAssigning] = useState<TaskWithPerson | null>(null);
  const [messaging, setMessaging] = useState<TaskWithPerson | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = useMemo<TaskFilters>(
    () => ({
      ...baseFilters,
      search: search || undefined,
      status: status ? [status] : baseFilters.status,
      type: type ? [type] : undefined,
      assigneeId: assignee ? assignee : baseFilters.assigneeId,
      due: lockDue ? baseFilters.due : due === "all" ? undefined : due,
    }),
    [baseFilters, search, status, type, assignee, due, lockDue],
  );

  const { tasks, counts, create, complete, reschedule, assign, cancel } = useFollowUps(filters);
  const canEdit = can("tasks.write");
  const filtersApplied = Boolean(search || status || type || assignee || (!lockDue && due !== "all"));

  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setType("");
    setAssignee("");
    setDue("all");
  };

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description}
        actions={
          canEdit ? (
            <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <PlusIcon />
              New task
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open" value={counts.open} detail="Pending, in progress or rescheduled" />
        <StatTile label="Due today" value={counts.dueToday} detail={today} />
        <StatTile label="Overdue" value={counts.overdue} detail="Past the due date" />
        <StatTile
          label="No owner"
          value={counts.unassigned}
          detail="Open tasks with nobody assigned"
        />
      </div>

      <TaskTable
        rows={tasks}
        now={now}
        canEdit={canEdit}
        onComplete={setCompleting}
        onReschedule={setRescheduling}
        onAssign={setAssigning}
        onMessage={setMessaging}
        onCancel={(row) => cancel(row.task.id)}
        toolbar={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reference, person or notes"
              className="w-full sm:w-64"
              aria-label="Search tasks"
            />
            <NativeSelect
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus | "")}
              aria-label="Filter by status"
            >
              <NativeSelectOption value="">Any status</NativeSelectOption>
              {TASK_STATUSES.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {TASK_STATUS_LABELS[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              value={type}
              onChange={(event) => setType(event.target.value as FollowUpTaskType | "")}
              aria-label="Filter by task type"
            >
              <NativeSelectOption value="">Any type</NativeSelectOption>
              {(Object.keys(FOLLOW_UP_TASK_TYPE_LABELS) as FollowUpTaskType[]).map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {FOLLOW_UP_TASK_TYPE_LABELS[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {!lockDue ? (
              <NativeSelect
                value={due}
                onChange={(event) => setDue(event.target.value as TaskFilters["due"] & string)}
                aria-label="Filter by due window"
              >
                <NativeSelectOption value="all">Any due date</NativeSelectOption>
                <NativeSelectOption value="overdue">Overdue</NativeSelectOption>
                <NativeSelectOption value="today">Due today</NativeSelectOption>
                <NativeSelectOption value="upcoming">Upcoming</NativeSelectOption>
              </NativeSelect>
            ) : null}
            {can("tasks.read.all") ? (
              <NativeSelect
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                aria-label="Filter by assignee"
              >
                <NativeSelectOption value="">Anyone</NativeSelectOption>
                <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
                <NativeSelectOption value={teamMemberId}>Me</NativeSelectOption>
                {assignableTeam.map((member) => (
                  <NativeSelectOption key={member.id} value={member.id}>
                    {member.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
          </>
        }
        emptyState={
          filtersApplied ? (
            <NoResultsState
              context="tasks"
              onClear={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          )
        }
      />

      <CompleteTaskDialog
        task={completing}
        onOpenChange={(open) => !open && setCompleting(null)}
        onConfirm={(outcome, note) => {
          if (completing) complete(completing.task.id, outcome, note);
          setCompleting(null);
        }}
      />

      <RescheduleDialog
        task={rescheduling}
        today={today}
        onOpenChange={(open) => !open && setRescheduling(null)}
        onConfirm={(dueDate, reason) => {
          if (rescheduling) reschedule(rescheduling.task.id, dueDate, reason);
          setRescheduling(null);
        }}
      />

      <AssignDialog
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
        team={assignableTeam}
        count={1}
        onConfirm={(teamMember) => {
          if (assigning) assign(assigning.task.id, teamMember);
          setAssigning(null);
        }}
      />

      <MessageComposer
        person={messaging?.person ?? null}
        taskId={messaging?.task.id}
        onOpenChange={(open) => !open && setMessaging(null)}
      />

      <CreateTaskDialog
        open={creating}
        onOpenChange={setCreating}
        people={snapshot.people}
        team={assignableTeam}
        today={today}
        defaultDueInDays={snapshot.settings.defaultFollowUpDueInDays}
        onConfirm={(values: NewTaskValues) => {
          const outcome = create(values);
          if (outcome.ok) setCreating(false);
        }}
      />
    </PageShell>
  );
}
