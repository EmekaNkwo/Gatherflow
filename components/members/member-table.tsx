"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MoreHorizontalIcon } from "lucide-react";
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
import { displayName } from "@/lib/strings";
import { canJoinGroups } from "@/services/groups/groups";
import type { MemberRow } from "@/services/members/selectors";

interface MemberTableProps {
  rows: MemberRow[];
  toolbar?: React.ReactNode;
  emptyState: React.ReactNode;
  /** The signed-in role may send `member.changeStatus`. */
  canChangeStatus: boolean;
  /** The signed-in role may send `group.addMember`. */
  canAddToGroup: boolean;
  onChangeStatus: (row: MemberRow) => void;
  onAddToGroup: (row: MemberRow) => void;
}

/** The member directory as a table: the wide-screen view for staff work. */
export function MemberTable({
  rows,
  toolbar,
  emptyState,
  canChangeStatus,
  canAddToGroup,
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
              <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-foreground">
                Asked for contact
              </span>
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
          <TextCell value={groupSummary(row.original)} />
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
              <p className="max-w-64 text-xs whitespace-normal text-primary dark:text-foreground">
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
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full"
                  aria-label={`Actions for ${displayName(row.original.person)}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={`/members/${row.original.person.id}`} />}>
                Open record
              </DropdownMenuItem>
              {canChangeStatus ? (
                <DropdownMenuItem onClick={() => onChangeStatus(row.original)}>
                  Change membership status
                </DropdownMenuItem>
              ) : null}
              {/* People who have transferred or been archived can't join a group. */}
              {canAddToGroup && canJoinGroups(row.original.person) ? (
                <DropdownMenuItem onClick={() => onAddToGroup(row.original)}>
                  Add to a group
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [canChangeStatus, canAddToGroup, onAddToGroup, onChangeStatus],
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

/** Their groups, with any that aren't meeting marked, so "in a group" reads true. */
function groupSummary(row: MemberRow): string {
  if (!row.groupNames.length) return "Not in a group";
  const paused = new Set(row.inactiveGroupNames);
  return row.groupNames.map((name) => (paused.has(name) ? `${name} (not meeting)` : name)).join(", ");
}
