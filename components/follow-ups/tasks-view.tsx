"use client";

import { useMemo, useState, type ReactNode } from "react";
import { PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, NoResultsState } from "@/components/shared/empty-state";
import { SelectField } from "@/components/shared/select-field";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { MessageComposer } from "@/components/communications/message-composer";
import { CancelTaskDialog } from "./cancel-task-dialog";
import { CompleteTaskDialog } from "./complete-task-dialog";
import { CreateTaskDialog, type NewTaskValues } from "./create-task-dialog";
import { RescheduleDialog } from "./reschedule-dialog";
import { TaskList } from "./task-list";
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
import { useRole } from "@/hooks/useRole";
import { useFollowUps, useTaskActionGate } from "@/hooks/useFollowUps";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useIsMobile } from "@/hooks/use-mobile";

const FILTER_TRIGGER_CLASS = "w-fit rounded-full";

const TASK_TYPE_FILTER_OPTIONS = [
  { value: "", label: "Any kind" },
  ...(Object.keys(FOLLOW_UP_TASK_TYPE_LABELS) as FollowUpTaskType[]).map((option) => ({
    value: option,
    label: FOLLOW_UP_TASK_TYPE_LABELS[option],
  })),
];

const DUE_FILTER_OPTIONS = [
  { value: "all", label: "Any day" },
  { value: "overdue", label: "Still waiting" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Coming up" },
];

interface TasksViewProps {
  title: string;
  description: string;
  /** Filters applied on top of whatever the role is allowed to see. */
  baseFilters?: TaskFilters;
  /** Hides the due-window filter on views that are already scoped by it. */
  lockDue?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  /**
   * `cards` shows people grouped by when they are due, everywhere; `table`
   * keeps the dense table for staff on a wide screen and uses cards on a
   * phone.
   */
  layout?: "cards" | "table";
  /** Shown above the list, e.g. "Showing one follow-up · Show all". */
  notice?: ReactNode;
}

/**
 * Refusals that mean the task changed under us (finished elsewhere, gone):
 * the church is re-read, and keeping the dialog open would only invite a
 * second refusal.
 */
const STALE_CODES = new Set(["closed", "not_found"]);

const OPEN_STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "rescheduled"];
const FINISHED_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"];

/**
 * The shared task view behind "my follow-ups", "everyone's follow-ups" and
 * "finished", so every one of them filters, sorts and acts the same way.
 *
 * It opens on what is still to do; finished work is one tap away, and the
 * rarer filters sit behind "More filters".
 */
export function TasksView({
  title,
  description,
  baseFilters = {},
  lockDue = false,
  emptyTitle,
  emptyDescription,
  layout = "table",
  notice,
}: TasksViewProps) {
  const isMobile = useIsMobile();
  const asCards = layout === "cards" || isMobile;
  const fixedStatus = baseFilters.status !== undefined;
  const now = useNow();
  const today = toIsoDate(now);
  const snapshot = useSnapshot();
  const { assignableTeam, can, teamMemberId } = useRole();
  const allows = useTaskActionGate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [type, setType] = useState<FollowUpTaskType | "">("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState<NonNullable<TaskFilters["due"]>>(baseFilters.due ?? "all");
  const [show, setShow] = useState<"todo" | "finished">("todo");
  const [moreFilters, setMoreFilters] = useState(false);

  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);
  const [assigning, setAssigning] = useState<TaskWithPerson | null>(null);
  const [messaging, setMessaging] = useState<TaskWithPerson | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<TaskWithPerson | null>(null);

  const filters = useMemo<TaskFilters>(
    () => ({
      ...baseFilters,
      search: search || undefined,
      status: status
        ? [status]
        : (baseFilters.status ?? (show === "todo" ? OPEN_STATUSES : FINISHED_STATUSES)),
      type: type ? [type] : undefined,
      assigneeId: assignee ? assignee : baseFilters.assigneeId,
      due: lockDue ? baseFilters.due : due === "all" ? undefined : due,
    }),
    [baseFilters, search, status, type, assignee, due, lockDue, show],
  );

  const { tasks, create, complete, reschedule, assign, cancel, scope } = useFollowUps(filters);
  const canEdit = can("tasks.write");
  const filtersApplied = Boolean(search || status || type || assignee || (!lockDue && due !== "all"));

  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setType("");
    setAssignee("");
    setDue("all");
  };

  // What the list is actually showing, from the statuses in force — so a
  // status picked under "More filters" can never put finished work in the
  // to-do groups, or open work under "Finished".
  const statusesShown = filters.status ?? OPEN_STATUSES;
  const finishedView = statusesShown.every((entry) => FINISHED_STATUSES.includes(entry));
  const statusOptions = fixedStatus
    ? (baseFilters.status ?? TASK_STATUSES)
    : show === "todo"
      ? OPEN_STATUSES
      : FINISHED_STATUSES;
  const groups = tasks.length === 0
    ? []
    : finishedView
    ? [{ title: null, rows: tasks }]
    : [
        { title: "Still waiting", rows: tasks.filter((entry) => entry.overdue) },
        { title: "Today", rows: tasks.filter((entry) => entry.dueToday) },
        { title: "Coming up", rows: tasks.filter((entry) => !entry.overdue && !entry.dueToday) },
      ].filter((group) => group.rows.length > 0);

  const toolbar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!fixedStatus ? (
          <div role="group" aria-label="Show" className="inline-flex rounded-full bg-muted p-1">
            {(["todo", "finished"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={show === option}
                onClick={() => {
                  setShow(option);
                  setStatus("");
                }}
                className={cn(
                  "min-h-11 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  show === option && "bg-card text-foreground shadow-sm",
                )}
              >
                {option === "todo" ? "To do" : "Finished"}
              </button>
            ))}
          </div>
        ) : null}
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          className="order-last h-10 min-w-0 basis-full rounded-full sm:order-none sm:max-w-64 sm:basis-auto"
          aria-label="Search follow-ups"
        />
        <Button
          variant="ghost"
          className="min-h-11 rounded-full"
          aria-expanded={moreFilters}
          onClick={() => setMoreFilters((open) => !open)}
        >
          <SlidersHorizontalIcon />
          More filters
        </Button>
      </div>
      {moreFilters ? (
        <div className="flex flex-wrap gap-2">
          <SelectField
            value={status}
            onValueChange={(value) => setStatus(value as TaskStatus | "")}
            aria-label="Filter by status"
            triggerClassName={FILTER_TRIGGER_CLASS}
            options={[
              { value: "", label: "Any status" },
              ...statusOptions.map((option) => ({ value: option, label: TASK_STATUS_LABELS[option] })),
            ]}
          />
          <SelectField
            value={type}
            onValueChange={(value) => setType(value as FollowUpTaskType | "")}
            aria-label="Filter by kind of follow-up"
            triggerClassName={FILTER_TRIGGER_CLASS}
            options={TASK_TYPE_FILTER_OPTIONS}
          />
          {!lockDue ? (
            <SelectField
              value={due}
              onValueChange={(value) => setDue(value as TaskFilters["due"] & string)}
              aria-label="Filter by when it is due"
              triggerClassName={FILTER_TRIGGER_CLASS}
              options={DUE_FILTER_OPTIONS}
            />
          ) : null}
          {can("tasks.read.all") && !baseFilters.assigneeId ? (
            <SelectField
              value={assignee}
              onValueChange={setAssignee}
              aria-label="Filter by who it is for"
              triggerClassName={FILTER_TRIGGER_CLASS}
              options={[
                { value: "", label: "Anyone" },
                { value: "unassigned", label: "No owner (or no longer active)" },
                ...(teamMemberId ? [{ value: teamMemberId, label: "Me" }] : []),
                ...assignableTeam.map((member) => ({ value: member.id, label: member.name })),
              ]}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const emptyState = filtersApplied ? (
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
  );

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description}
        actions={
          canEdit ? (
            <Button variant="outline" className="gap-1.5 rounded-full" onClick={() => setCreating(true)}>
              <PlusIcon />
              Add a follow-up
            </Button>
          ) : null
        }
      />

      {asCards ? (
        <div className="space-y-8">
          {notice}
          {toolbar}
          {groups.length === 0 ? emptyState : null}
          {groups.map((group) =>
            group.title ? (
              <Section key={group.title} title={group.title}>
                <TaskList
                  tasks={group.rows}
                  now={now}
                  emptyMessage=""
                  showAssignee={can("tasks.read.all")}
                  allows={allows}
                  onComplete={setCompleting}
                  onReschedule={setRescheduling}
                  onMessage={setMessaging}
                  onAssign={setAssigning}
                  onCancel={setCancelling}
                />
              </Section>
            ) : (
              <TaskList
                key="finished"
                tasks={group.rows}
                now={now}
                emptyMessage=""
                showAssignee={can("tasks.read.all")}
              />
            ),
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {notice}
          <TaskTable
            rows={tasks}
            now={now}
            allows={allows}
            onComplete={setCompleting}
            onReschedule={setRescheduling}
            onAssign={setAssigning}
            onMessage={setMessaging}
            onCancel={setCancelling}
            toolbar={toolbar}
            emptyState={emptyState}
          />
        </div>
      )}

      <CompleteTaskDialog
        task={completing}
        onOpenChange={(open) => !open && setCompleting(null)}
        onConfirm={async (outcome, note) => {
          if (!completing) return;
          // Stays open on a refusal, so the outcome chosen is not lost —
          // unless the task itself changed elsewhere, when the list refreshes.
          const result = await complete(completing.task.id, outcome, note);
          if (result.ok || STALE_CODES.has(result.code ?? "")) setCompleting(null);
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

      <CancelTaskDialog
        task={cancelling}
        onOpenChange={(open) => !open && setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          const result = await cancel(cancelling.task.id, reason);
          if (result.ok || STALE_CODES.has(result.code ?? "")) setCancelling(null);
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
        currentMemberId={teamMemberId ?? undefined}
        ownOnly={scope === "own"}
        onConfirm={async (values: NewTaskValues) => {
          const outcome = await create(values);
          if (outcome.ok) setCreating(false);
        }}
      />
    </PageShell>
  );
}
