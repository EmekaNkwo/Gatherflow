"use client";

import { useMemo, type ReactNode } from "react";
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

/** What can be done to one visitor from the table's row menu. */
export type VisitorAction = "assign" | "preferences" | "stop" | "reopen";

interface VisitorTableProps {
  rows: VisitorRow[];
  selected: ReadonlySet<string>;
  onToggle: (personId: string) => void;
  /**
   * Selects or clears the rows on the page being shown — never rows on other
   * pages the person cannot see.
   */
  onToggleAll: (pageIds: readonly string[]) => void;
  onAssign: (row: VisitorRow) => void;
  onStopFollowUp: (row: VisitorRow) => void;
  onPreferences: (row: VisitorRow) => void;
  onReopen?: (row: VisitorRow) => void;
  toolbar?: ReactNode;
  emptyState: ReactNode;
  /** Per-visitor check (`canRun` underneath), so only allowed actions show. */
  allows: (action: VisitorAction, row: VisitorRow) => boolean;
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
  onReopen,
  toolbar,
  emptyState,
  allows,
}: VisitorTableProps) {
  const columns = useMemo<GatherFlowColumn<VisitorRow>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        enableSorting: false,
        header: ({ table }) => {
          const pageIds = table.getRowModel().rows.map((entry) => entry.original.person.id);
          const allOnPage = pageIds.length > 0 && pageIds.every((personId) => selected.has(personId));
          return (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onToggleAll(pageIds)}
              aria-label={allOnPage ? "Clear the visitors on this page" : "Select all visitors on this page"}
            >
              {allOnPage ? <CheckSquareIcon /> : <SquareIcon />}
            </Button>
          );
        },
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
        cell: ({ row }) => <TextCell value={row.original.assigneeName ?? "Nobody yet"} />,
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
              {allows("assign", row.original) ? (
                <DropdownMenuItem onClick={() => onAssign(row.original)}>Assign follow-up</DropdownMenuItem>
              ) : null}
              {allows("preferences", row.original) ? (
                <DropdownMenuItem onClick={() => onPreferences(row.original)}>Contact preferences</DropdownMenuItem>
              ) : null}
              {onReopen && allows("reopen", row.original) ? (
                <DropdownMenuItem onClick={() => onReopen(row.original)}>Reopen follow-up</DropdownMenuItem>
              ) : null}
              {allows("stop", row.original) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onStopFollowUp(row.original)}>Stop follow-up</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [allows, onAssign, onPreferences, onReopen, onStopFollowUp, onToggle, onToggleAll, selected],
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
