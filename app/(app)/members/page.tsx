"use client";

import { AddMemberButton } from "@/components/members/add-member-button";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRightIcon, DownloadIcon, SlidersHorizontalIcon, UserPlusIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, NoResultsState } from "@/components/shared/empty-state";
import { OptedOutBadge } from "@/components/shared/badges";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { MemberTable } from "@/components/members/member-table";
import { AddToGroupDialog, MembershipStatusDialog } from "@/components/members/member-dialogs";
import { displayName } from "@/lib/strings";
import { MEMBER_FILTER_LABELS, type MemberFilter, type MemberRow } from "@/services/members/selectors";
import { CURRENT_MEMBER_STATUSES } from "@/services/groups/participation";
import { commandFor } from "@/services/commands/registry";
import { useRole } from "@/hooks/useRole";
import { useGroups } from "@/hooks/useGroups";
import { useMembers } from "@/hooks/useMembers";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSnapshot } from "@/hooks/use-church-data";

const FILTERS = Object.keys(MEMBER_FILTER_LABELS) as MemberFilter[];
/** The views people reach for; the rest are one tap away in "More". */
const MAIN_FILTERS: readonly MemberFilter[] = ["all", "new", "needs_review", "no_group"];
/** The "More…" select lists every view that isn't a main pill. */
const MORE_VIEW_OPTIONS: SelectOption[] = [
  { value: "", label: "More…" },
  ...FILTERS.filter((option) => !MAIN_FILTERS.includes(option)).map((option) => ({
    value: option,
    label: MEMBER_FILTER_LABELS[option],
  })),
];
const SHORT_LABELS: Partial<Record<MemberFilter, string>> = {
  all: "Everyone",
  new: "New",
  needs_review: "Not seen lately",
  no_group: "Not in a group",
};
/** How many people the phone list shows before "Show all". */
const PHONE_PAGE = 30;

/**
 * Members: who belongs to the church, findable fast. Search first, four
 * common views, then people as a list on a phone or the full table (with
 * row actions and column choices) on a wide screen.
 */
export default function MembersPage() {
  const params = useSearchParams();
  const initial = (params.get("filter") as MemberFilter | null) ?? "all";

  const [filter, setFilter] = useState<MemberFilter>(
    FILTERS.includes(initial) ? initial : "all",
  );
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [statusFor, setStatusFor] = useState<MemberRow | null>(null);
  const [groupFor, setGroupFor] = useState<MemberRow | null>(null);

  const snapshot = useSnapshot();
  const { can } = useRole();
  const isMobile = useIsMobile();
  const { groups, addMember } = useGroups();
  const { rows, breakdown, participation, changeStatus, exportCsv } = useMembers(
    useMemo(
      () => ({ filter, search: search || undefined, groupId: groupId || undefined }),
      [filter, search, groupId],
    ),
  );

  // Gated by the commands the row actions send, exactly as the server checks them.
  const canChangeStatus = can(commandFor("member.changeStatus").capability);
  const canAddToGroup = can(commandFor("group.addMember").capability);
  const canExport = can("exports.run");
  const filtersApplied = Boolean(search || groupId || filter !== "all");
  const criteria = snapshot.settings.engagement;

  // One definition of "a member" for the header and the Everyone list:
  // current members (transferred and archived sit under "More…").
  const memberCount = breakdown
    .filter((entry) => CURRENT_MEMBER_STATUSES.includes(entry.status))
    .reduce((sum, entry) => sum + entry.count, 0);
  const description =
    participation.percentage === null
      ? `${memberCount} members`
      : `${memberCount} members · ${participation.percentage}% are in a group`;

  const clearFilters = () => {
    setFilter("all");
    setSearch("");
    setGroupId("");
  };

  const exportButton = canExport ? (
    <Button variant="ghost" className="min-h-11 gap-1.5 rounded-full" onClick={() => exportCsv()}>
      <DownloadIcon />
      Export
    </Button>
  ) : null;

  const emptyState = filtersApplied ? (
    <NoResultsState
      context="members"
      onClear={
        <Button variant="outline" className="min-h-11 rounded-full" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      title="No members yet"
      description="Add a member here, or confirm a visitor as a member from their page."
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Members"
        description={description}
        actions={
          <>
            {isMobile ? null : exportButton}
            <AddMemberButton className="min-h-11 gap-1.5 rounded-full">
              <UserPlusIcon />
              Add a member
            </AddMemberButton>
          </>
        }
      />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isMobile ? "Search by name or phone" : "Search name, member ID, phone or email"}
            className="h-11 min-w-0 flex-1 rounded-full sm:max-w-md"
            aria-label="Search members"
          />
          <Button
            variant="ghost"
            className="min-h-11 shrink-0 rounded-full"
            aria-expanded={moreFilters}
            onClick={() => setMoreFilters((open) => !open)}
          >
            <SlidersHorizontalIcon />
            <span className="sr-only sm:not-sr-only">More filters</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {MAIN_FILTERS.map((option) => (
            <Button
              key={option}
              variant={filter === option ? "default" : "outline"}
              className="min-h-11 rounded-full sm:min-h-10"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {SHORT_LABELS[option]}
            </Button>
          ))}
          <SelectField
            aria-label="More views"
            value={MAIN_FILTERS.includes(filter) ? "" : filter}
            onValueChange={(value) => setFilter((value || "all") as MemberFilter)}
            triggerClassName={cn("w-auto rounded-full", !MAIN_FILTERS.includes(filter) && "border-primary")}
            options={MORE_VIEW_OPTIONS}
          />
        </div>

        {moreFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              value={groupId}
              onValueChange={setGroupId}
              aria-label="Filter by group"
              triggerClassName="w-auto rounded-full"
              options={[
                { value: "", label: "Any group" },
                ...groups.map((entry) => ({ value: entry.group.id, label: entry.group.name })),
              ]}
            />
            {isMobile ? exportButton : null}
          </div>
        ) : null}

        {filter === "needs_review" ? (
          <p className="text-sm text-muted-foreground">
            No attendance recorded for {criteria.inactiveAfterWeeksAbsent} weeks or more. A gentle prompt to
            check in; nobody&apos;s status changes on its own.
          </p>
        ) : null}
      </div>

      {isMobile ? (
        <MemberList rows={rows} showAll={showAll} onToggleAll={() => setShowAll((all) => !all)} emptyState={emptyState} />
      ) : (
        <MemberTable
          rows={rows}
          canChangeStatus={canChangeStatus}
          canAddToGroup={canAddToGroup}
          onChangeStatus={setStatusFor}
          onAddToGroup={setGroupFor}
          emptyState={emptyState}
        />
      )}

      <MembershipStatusDialog
        open={statusFor !== null}
        onOpenChange={(open) => !open && setStatusFor(null)}
        personName={statusFor ? displayName(statusFor.person) : ""}
        current={statusFor?.status ?? "active"}
        onConfirm={(status, reason) => {
          if (statusFor) changeStatus(statusFor.person.id, status, reason);
          setStatusFor(null);
        }}
      />

      <AddToGroupDialog
        open={groupFor !== null}
        onOpenChange={(open) => !open && setGroupFor(null)}
        personName={groupFor ? displayName(groupFor.person) : ""}
        groups={snapshot.groups}
        onConfirm={(group) => {
          if (groupFor) addMember(group, groupFor.person.id);
          setGroupFor(null);
        }}
      />
    </PageShell>
  );
}

/** One short, kind line about where this person is right now. */
function memberHint(row: MemberRow): string {
  if (row.reviewReason && row.weeksSinceAttendance !== undefined) {
    return `Not seen for ${row.weeksSinceAttendance} weeks`;
  }
  if (row.person.member?.requestedContact) return "Asked to be contacted";
  if (row.inActiveGroup) return row.groupNames.join(", ");
  return "Not in a group yet";
}

/**
 * The phone view: people, not rows. Name, status in words and one hint.
 * Changing status or adding to a group happens on the person's own page.
 */
function MemberList({
  rows,
  showAll,
  onToggleAll,
  emptyState,
}: {
  rows: MemberRow[];
  showAll: boolean;
  onToggleAll: () => void;
  emptyState: ReactNode;
}) {
  if (!rows.length) return <>{emptyState}</>;

  const visible = showAll ? rows : rows.slice(0, PHONE_PAGE);

  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-3xl border bg-card" aria-label="Members">
        {visible.map((row) => (
          <li key={row.person.id}>
            <Link
              href={`/members/${row.person.id}`}
              className="flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{displayName(row.person)}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {row.statusLabel} · {memberHint(row)}
                </span>
              </span>
              {row.person.contact.optedOut ? (
                <OptedOutBadge className="shrink-0" />
              ) : row.reviewReason ? (
                <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-foreground">
                  Check in
                </span>
              ) : null}
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > PHONE_PAGE ? (
        <Button variant="ghost" className="min-h-11 rounded-full" onClick={onToggleAll}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </Button>
      ) : null}
    </div>
  );
}
