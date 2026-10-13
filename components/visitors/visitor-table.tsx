"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CheckSquareIcon, MoreHorizontalIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, TextCell, type GatherFlowColumn } from "@/components/shared/data-table";
import { OverdueBadge, StageBadge } from "@/components/shared/badges";
import { PersonCell } from "@/components/shared/person-cell";
import { formatShortDate } from "@/lib/dates";
import type { VisitorRow } from "@/services/visitors/selectors";

interface VisitorTableProps {
  rows: VisitorRow[];
  selected: ReadonlySet<string>;
  onToggle: (personId: string) => void;
  onToggleAll: () => void;
  onAssign: (row: VisitorRow) => void;
  onStopFollowUp: (row: VisitorRow) => void;
  onPreferences: (row: VisitorRow) => void;
  toolbar?: React.ReactNode;
  emptyState: React.ReactNode;
  canEdit: boolean;
}

/** The visitor directory table. */
export function VisitorTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onAssign,
  onStopFollowUp,
  onPreferences,
  toolbar,
  emptyState,
  canEdit,
}: VisitorTableProps) {
  const columns = useMemo<GatherFlowColumn<VisitorRow>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        enableSorting: false,
        header: () => (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onToggleAll}
            aria-label="Select all visitors on this page"
          >
            {selected.size && selected.size === rows.length ? (
              <CheckSquareIcon />
            ) : (
              <SquareIcon />
            )}
          </Button>
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.person.id)}
            onCheckedChange={() => onToggle(row.original.person.id)}
            aria-label={`Select ${row.original.person.firstName} ${row.original.person.lastName}`}
          />
        ),
      },
      {
        id: "visitor",
        header: "Visitor",
        accessorFn: (row) => `${row.person.lastName} ${row.person.firstName}`,
        cell: ({ row }) => (
          <PersonCell
            person={row.original.person}
            href={`/visitors/${row.original.person.id}`}
            subtitle={row.original.person.phone ?? row.original.person.email ?? "No contact details"}
          />
        ),
      },
      {
        id: "firstVisit",
        header: "First visit",
        accessorFn: (row) => row.firstVisit,
        cell: ({ row }) => <TextCell value={formatShortDate(row.original.firstVisit)} />,
      },
      {
        id: "lastVisit",
        header: "Last visit",
        accessorFn: (row) => row.lastVisit ?? "",
        cell: ({ row }) => <TextCell value={formatShortDate(row.original.lastVisit)} />,
      },
      {
        id: "visits",
        header: "Visits",
        accessorFn: (row) => row.visits,
        cell: ({ row }) => <span className="tabular-nums">{row.original.visits}</span>,
      },
      {
        id: "status",
        header: "Follow-up status",
        accessorFn: (row) => row.statusLabel,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StageBadge
              name={row.original.statusLabel}
              terminal={row.original.stage?.kind === "terminal"}
            />
            {row.original.hasOverdue ? <OverdueBadge /> : null}
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
        id: "nextFollowUp",
        header: "Next follow-up",
        accessorFn: (row) => row.nextFollowUpDate ?? "",
        cell: ({ row }) => <TextCell value={formatShortDate(row.original.nextFollowUpDate)} />,
      },
      {
        id: "preferredContact",
        header: "Preferred contact",
        accessorFn: (row) => row.preferredContactLabel,
        cell: ({ row }) => <TextCell value={row.original.preferredContactLabel} />,
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Visitor actions">
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={`/visitors/${row.original.person.id}`} />}>
                Open record
              </DropdownMenuItem>
              {canEdit ? (
                <>
                  <DropdownMenuItem onClick={() => onAssign(row.original)}>
                    Assign follow-up
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPreferences(row.original)}>
                    Contact preferences
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onStopFollowUp(row.original)}
                    disabled={Boolean(row.original.closedReason)}
                  >
                    Stop follow-up
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [canEdit, onAssign, onPreferences, onStopFollowUp, onToggle, onToggleAll, rows.length, selected],
  );

  return (
    <DataTable
      label="Visitor directory"
      columns={columns}
      data={rows}
      getRowId={(row) => row.person.id}
      emptyState={emptyState}
      toolbar={toolbar}
      hiddenByDefault={["preferredContact"]}
    />
  );
}
