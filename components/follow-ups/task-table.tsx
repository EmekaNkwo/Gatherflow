"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, TextCell, type GatherFlowColumn } from "@/components/shared/data-table";
import {
  OverdueBadge,
  PriorityBadge,
  TaskStatusBadge,
} from "@/components/shared/badges";
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { describeDueDate, formatShortDate } from "@/lib/dates";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  TASK_OUTCOME_LABELS,
} from "@/types/follow-up";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";

interface TaskTableProps {
  rows: TaskWithPerson[];
  now: Date;
  toolbar?: React.ReactNode;
  emptyState: React.ReactNode;
  canEdit: boolean;
  onComplete: (row: TaskWithPerson) => void;
  onReschedule: (row: TaskWithPerson) => void;
  onAssign: (row: TaskWithPerson) => void;
  onCancel: (row: TaskWithPerson) => void;
  onMessage: (row: TaskWithPerson) => void;
}

/** The follow-up task table shared by every task view. */
export function TaskTable({
  rows,
  now,
  toolbar,
  emptyState,
  canEdit,
  onComplete,
  onReschedule,
  onAssign,
  onCancel,
  onMessage,
}: TaskTableProps) {
  const columns = useMemo<GatherFlowColumn<TaskWithPerson>[]>(
    () => [
      {
        id: "reference",
        header: "Task",
        accessorFn: (row) => row.task.reference,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="font-medium">{FOLLOW_UP_TASK_TYPE_LABELS[row.original.task.type]}</p>
            <p className="text-xs text-muted-foreground">{row.original.task.reference}</p>
          </div>
        ),
      },
      {
        id: "person",
        header: "Person",
        accessorFn: (row) =>
          row.person ? `${row.person.lastName} ${row.person.firstName}` : "",
        cell: ({ row }) =>
          row.original.person ? (
            <PersonCell
              person={row.original.person}
              href={personHref(row.original.person)}
              subtitle={row.original.task.notes ?? undefined}
            />
          ) : (
            <TextCell value="Unknown person" />
          ),
      },
      {
        id: "due",
        header: "Due",
        accessorFn: (row) => row.task.dueDate,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p>{formatShortDate(row.original.task.dueDate)}</p>
            <p
              className={
                row.original.overdue
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {describeDueDate(row.original.task.dueDate, now)}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.task.status,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskStatusBadge status={row.original.task.status} />
            <PriorityBadge priority={row.original.task.priority} />
            {row.original.overdue ? <OverdueBadge /> : null}
          </div>
        ),
      },
      {
        id: "assignee",
        header: "Assigned to",
        accessorFn: (row) => row.assigneeName ?? "",
        cell: ({ row }) => <TextCell value={row.original.assigneeName ?? "Unassigned"} />,
      },
      {
        id: "outcome",
        header: "Outcome",
        accessorFn: (row) => row.task.outcome ?? "",
        cell: ({ row }) => (
          <div className="max-w-56 space-y-0.5">
            <TextCell
              value={
                row.original.task.outcome
                  ? TASK_OUTCOME_LABELS[row.original.task.outcome]
                  : undefined
              }
            />
            {row.original.task.outcomeNote ? (
              <p className="truncate text-xs text-muted-foreground">
                {row.original.task.outcomeNote}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "origin",
        header: "Created by",
        accessorFn: (row) => row.task.origin,
        cell: ({ row }) => (
          <TextCell
            value={
              row.original.task.origin === "manual"
                ? "Manually"
                : `Automation · ${row.original.task.origin.replace("rule:", "").replace(/_/g, " ")}`
            }
          />
        ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const open = ["pending", "in_progress", "rescheduled"].includes(
            row.original.task.status,
          );
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="Task actions">
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {row.original.person ? (
                  <DropdownMenuItem render={<Link href={personHref(row.original.person)} />}>
                    Open the person&apos;s record
                  </DropdownMenuItem>
                ) : null}
                {canEdit && open ? (
                  <>
                    <DropdownMenuItem onClick={() => onComplete(row.original)}>
                      Complete with an outcome
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onReschedule(row.original)}>
                      Reschedule
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAssign(row.original)}>
                      Reassign
                    </DropdownMenuItem>
                    {row.original.person && !row.original.person.contact.optedOut ? (
                      <DropdownMenuItem onClick={() => onMessage(row.original)}>
                        Prepare a message
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onCancel(row.original)}>
                      Cancel task
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [canEdit, now, onAssign, onCancel, onComplete, onMessage, onReschedule],
  );

  return (
    <DataTable
      label="Follow-up tasks"
      columns={columns}
      data={rows}
      getRowId={(row) => row.task.id}
      emptyState={emptyState}
      toolbar={toolbar}
      hiddenByDefault={["origin"]}
    />
  );
}
