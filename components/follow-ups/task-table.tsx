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
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { describeDueDate, formatShortDate } from "@/lib/dates";
import { cn } from "cn";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  TASK_OUTCOME_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskStatus,
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

const FINISHED: readonly TaskStatus[] = ["completed", "cancelled"];

const CHIP_TONES = {
  muted: "bg-muted text-muted-foreground",
  done: "bg-done/15 text-done dark:text-foreground",
  accent: "bg-primary/12 text-primary dark:text-foreground",
} as const;

function Chip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", CHIP_TONES[tone])}>{children}</span>;
}

/**
 * The follow-up table for staff at a desk: person first, what to do in plain
 * words, and when. The task reference and how it was created are hidden
 * columns, one click away in the column menu.
 */
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
        id: "person",
        header: "Person",
        accessorFn: (row) =>
          row.person ? `${row.person.lastName} ${row.person.firstName}` : "",
        cell: ({ row }) =>
          row.original.person ? (
            <PersonCell person={row.original.person} href={personHref(row.original.person)} />
          ) : (
            <span className="text-muted-foreground">Somebody no longer on record</span>
          ),
      },
      {
        id: "type",
        header: "What to do",
        accessorFn: (row) => FOLLOW_UP_TASK_TYPE_LABELS[row.task.type],
        cell: ({ row }) => (
          <div className="max-w-64 space-y-0.5">
            <p>{FOLLOW_UP_TASK_TYPE_LABELS[row.original.task.type]}</p>
            {row.original.task.notes ? (
              <p className="truncate text-sm text-muted-foreground">{row.original.task.notes}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: "due",
        header: "When",
        accessorFn: (row) => row.task.dueDate,
        cell: ({ row }) => {
          const finished = FINISHED.includes(row.original.task.status);
          return (
            <div className="space-y-0.5">
              <p>{formatShortDate(row.original.task.dueDate)}</p>
              {finished ? null : (
                <p
                  className={cn(
                    "text-sm",
                    row.original.overdue ? "font-medium text-primary dark:text-foreground" : "text-muted-foreground",
                  )}
                >
                  {describeDueDate(row.original.task.dueDate, now)}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Where it's at",
        accessorFn: (row) => row.task.status,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={row.original.task.status === "completed" ? "done" : "muted"}>
              {TASK_STATUS_LABELS[row.original.task.status]}
            </Chip>
            {row.original.task.priority !== "normal" ? (
              <Chip tone="accent">{TASK_PRIORITY_LABELS[row.original.task.priority]}</Chip>
            ) : null}
          </div>
        ),
      },
      {
        id: "assignee",
        header: "Who's doing it",
        accessorFn: (row) => row.assigneeName ?? "",
        cell: ({ row }) =>
          row.original.assigneeName ? (
            <span>{row.original.assigneeName}</span>
          ) : (
            <span className="text-muted-foreground">Nobody yet</span>
          ),
      },
      {
        id: "outcome",
        header: "What happened",
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
              <p className="truncate text-sm text-muted-foreground">
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
                ? "Someone on the team"
                : `Automatically · ${row.original.task.origin.replace("rule:", "").replace(/_/g, " ")}`
            }
          />
        ),
      },
      {
        id: "reference",
        header: "Reference",
        accessorFn: (row) => row.task.reference,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">{row.original.task.reference}</span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const open = !FINISHED.includes(row.original.task.status);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Task actions">
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-56">
                {canEdit && open ? (
                  <>
                    <DropdownMenuItem className="min-h-11" onClick={() => onComplete(row.original)}>
                      Done: record what happened
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onClick={() => onReschedule(row.original)}>
                      Move to another day
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onClick={() => onAssign(row.original)}>
                      Give to someone else
                    </DropdownMenuItem>
                    {row.original.person && !row.original.person.contact.optedOut ? (
                      <DropdownMenuItem className="min-h-11" onClick={() => onMessage(row.original)}>
                        Write a message
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : null}
                {row.original.person ? (
                  <DropdownMenuItem className="min-h-11" render={<Link href={personHref(row.original.person)} />}>
                    Open their page
                  </DropdownMenuItem>
                ) : null}
                {canEdit && open ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => onCancel(row.original)}>
                      Stop this follow-up
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
      hiddenByDefault={["origin", "reference"]}
    />
  );
}
