"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MoreHorizontalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, TextCell, type GatherFlowColumn } from "@/components/shared/data-table";
import { MembershipStatusBadge } from "@/components/shared/badges";
import { PersonCell } from "@/components/shared/person-cell";
import { formatShortDate } from "@/lib/dates";
import type { MemberRow } from "@/services/members/selectors";

interface MemberTableProps {
  rows: MemberRow[];
  toolbar?: React.ReactNode;
  emptyState: React.ReactNode;
  canEdit: boolean;
  onChangeStatus: (row: MemberRow) => void;
  onAddToGroup: (row: MemberRow) => void;
}

/** The member directory table. */
export function MemberTable({
  rows,
  toolbar,
  emptyState,
  canEdit,
  onChangeStatus,
  onAddToGroup,
}: MemberTableProps) {
  const columns = useMemo<GatherFlowColumn<MemberRow>[]>(
    () => [
      {
        id: "member",
        header: "Member",
        accessorFn: (row) => `${row.person.lastName} ${row.person.firstName}`,
        cell: ({ row }) => (
          <PersonCell
            person={row.original.person}
            href={`/members/${row.original.person.id}`}
            subtitle={row.original.reference}
          />
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.status,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <MembershipStatusBadge status={row.original.status} />
            {row.original.person.member?.requestedContact ? (
              <Badge variant="secondary">Asked for contact</Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "membershipDate",
        header: "Member since",
        accessorFn: (row) => row.membershipDate,
        cell: ({ row }) => <TextCell value={formatShortDate(row.original.membershipDate)} />,
      },
      {
        id: "groups",
        header: "Groups",
        accessorFn: (row) => row.groupNames.join(", "),
        cell: ({ row }) => (
          <TextCell value={row.original.groupNames.join(", ") || "Not in a group"} />
        ),
      },
      {
        id: "lastAttendance",
        header: "Last attendance",
        accessorFn: (row) => row.lastAttendance ?? "",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <TextCell value={formatShortDate(row.original.lastAttendance)} />
            {row.original.reviewReason ? (
              <p className="max-w-64 text-xs text-amber-600 dark:text-amber-500">
                {row.original.reviewReason}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "household",
        header: "Household",
        accessorFn: (row) => row.householdName ?? "",
        cell: ({ row }) => <TextCell value={row.original.householdName} />,
      },
      {
        id: "preferredService",
        header: "Preferred service",
        accessorFn: (row) => row.person.member?.preferredServiceType ?? "",
        cell: ({ row }) => (
          <TextCell
            value={row.original.person.member?.preferredServiceType?.replace(/_/g, " ")}
          />
        ),
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
                <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={`/members/${row.original.person.id}`} />}>
                Open record
              </DropdownMenuItem>
              {canEdit ? (
                <>
                  <DropdownMenuItem onClick={() => onChangeStatus(row.original)}>
                    Change membership status
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAddToGroup(row.original)}>
                    Add to a group
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [canEdit, onAddToGroup, onChangeStatus],
  );

  return (
    <DataTable
      label="Member directory"
      columns={columns}
      data={rows}
      getRowId={(row) => row.person.id}
      emptyState={emptyState}
      toolbar={toolbar}
      hiddenByDefault={["household", "preferredService"]}
    />
  );
}
