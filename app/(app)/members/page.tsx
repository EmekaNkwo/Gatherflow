"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DownloadIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, NoResultsState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/metric-card";
import { MemberTable } from "@/components/members/member-table";
import { AddToGroupDialog, MembershipStatusDialog } from "@/components/members/member-dialogs";
import { displayName } from "@/lib/strings";
import { formatRatio } from "@/lib/metrics";
import { MEMBER_FILTER_LABELS, type MemberFilter, type MemberRow } from "@/services/members/selectors";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useGroups } from "@/hooks/useGroups";
import { useMembers } from "@/hooks/useMembers";
import { useSnapshot } from "@/hooks/use-church-data";

const FILTERS = Object.keys(MEMBER_FILTER_LABELS) as MemberFilter[];

/** The member directory, with the criteria behind every filter spelled out. */
export default function MembersPage() {
  const params = useSearchParams();
  const initial = (params.get("filter") as MemberFilter | null) ?? "all";

  const [filter, setFilter] = useState<MemberFilter>(
    FILTERS.includes(initial) ? initial : "all",
  );
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [statusFor, setStatusFor] = useState<MemberRow | null>(null);
  const [groupFor, setGroupFor] = useState<MemberRow | null>(null);

  const snapshot = useSnapshot();
  const { can } = useDemoRole();
  const { groups, addMember } = useGroups();
  const { rows, breakdown, participation, changeStatus, exportCsv } = useMembers(
    useMemo(
      () => ({ filter, search: search || undefined, groupId: groupId || undefined }),
      [filter, search, groupId],
    ),
  );

  const canEdit = can("people.write");
  const filtersApplied = Boolean(search || groupId || filter !== "all");
  const criteria = snapshot.settings.engagement;

  return (
    <PageShell>
      <PageHeader
        title="Members"
        description={`${rows.length} records in this view. "Flagged for review" means no recorded attendance for ${criteria.inactiveAfterWeeksAbsent} weeks — a prompt to check in, never an automatic status change.`}
        actions={
          <>
            {can("exports.run") ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv()}>
                <DownloadIcon />
                Export CSV
              </Button>
            ) : null}
            {canEdit ? (
              <LinkButton size="sm" href="/members/new" className="gap-1.5">
                <UserPlusIcon />
                Add a member
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {breakdown.slice(0, 3).map((entry) => (
          <StatTile key={entry.status} label={entry.label} value={entry.count} />
        ))}
        <StatTile
          label="In an active group"
          value={participation.percentage === null ? "—" : `${participation.percentage}%`}
          detail={formatRatio(participation)}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <Button
            key={option}
            variant={filter === option ? "default" : "outline"}
            size="xs"
            onClick={() => setFilter(option)}
          >
            {MEMBER_FILTER_LABELS[option]}
          </Button>
        ))}
      </div>

      <MemberTable
        rows={rows}
        canEdit={canEdit}
        onChangeStatus={setStatusFor}
        onAddToGroup={setGroupFor}
        toolbar={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, member ID, phone or email"
              className="w-full sm:w-72"
              aria-label="Search members"
            />
            <NativeSelect
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              aria-label="Filter by group"
            >
              <NativeSelectOption value="">Any group</NativeSelectOption>
              {groups.map((entry) => (
                <NativeSelectOption key={entry.group.id} value={entry.group.id}>
                  {entry.group.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </>
        }
        emptyState={
          filtersApplied ? (
            <NoResultsState
              context="members"
              onClear={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                    setGroupId("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No members yet"
              description="Register a member directly, or confirm a visitor from their record."
            />
          )
        }
      />

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
