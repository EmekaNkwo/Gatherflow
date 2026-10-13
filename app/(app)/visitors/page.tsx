"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DownloadIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { EmptyState, NoResultsState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { VisitorTable } from "@/components/visitors/visitor-table";
import {
  AssignDialog,
  CloseFollowUpDialog,
  ContactPreferencesDialog,
} from "@/components/visitors/visitor-dialogs";
import { displayName } from "@/lib/strings";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useVisitors } from "@/hooks/useVisitors";
import {
  VISITOR_FILTER_LABELS,
  type VisitorFilter,
  type VisitorRow,
} from "@/services/visitors/selectors";

const FILTERS = Object.keys(VISITOR_FILTER_LABELS) as VisitorFilter[];

/** Visitor directory: search, filter, bulk-assign and export. */
export default function VisitorsPage() {
  const params = useSearchParams();
  const initialFilter = (params.get("filter") as VisitorFilter | null) ?? "all";

  const [filter, setFilter] = useState<VisitorFilter>(
    FILTERS.includes(initialFilter) ? initialFilter : "all",
  );
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [assigning, setAssigning] = useState<VisitorRow | "bulk" | null>(null);
  const [closing, setClosing] = useState<VisitorRow | null>(null);
  const [preferences, setPreferences] = useState<VisitorRow | null>(null);

  const { assignableTeam, can } = useDemoRole();
  const {
    rows,
    counts,
    assign,
    bulkAssign,
    bulkCreateTasks,
    stopFollowUp,
    updateContactPreferences,
    exportCsv,
  } = useVisitors(
    useMemo(
      () => ({
        filter,
        search,
        assigneeId: assigneeFilter
          ? (assigneeFilter as string)
          : undefined,
      }),
      [filter, search, assigneeFilter],
    ),
  );

  const canEdit = can("visitors.write");
  const selectedRows = rows.filter((row) => selected.has(row.person.id));

  const toggle = (personId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((previous) =>
      previous.size === rows.length ? new Set() : new Set(rows.map((row) => row.person.id)),
    );
  };

  const clearFilters = () => {
    setFilter("all");
    setSearch("");
    setAssigneeFilter("");
  };

  return (
    <PageShell>
      <PageHeader
        title="Visitors"
        description={`${counts.total} records in this view · ${counts.awaitingAssignment} awaiting assignment · ${counts.overdue} with overdue follow-up · ${counts.optedOut} asked not to be contacted.`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportCsv()} className="gap-1.5">
              <DownloadIcon />
              Export CSV
            </Button>
            {canEdit ? (
              <>
                <LinkButton variant="outline" size="sm" href="/visitors/quick">
                  Quick registration
                </LinkButton>
                <LinkButton size="sm" className="gap-1.5" href="/visitors/new">
                  <UserPlusIcon />
                  Register a visitor
                </LinkButton>
              </>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <Button
            key={option}
            variant={filter === option ? "default" : "outline"}
            size="xs"
            onClick={() => setFilter(option)}
          >
            {VISITOR_FILTER_LABELS[option]}
          </Button>
        ))}
      </div>

      {selectedRows.length && canEdit ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-3">
          <Badge variant="secondary">{selectedRows.length} selected</Badge>
          <Button size="sm" variant="outline" onClick={() => setAssigning("bulk")}>
            Assign to a volunteer
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              bulkCreateTasks(
                selectedRows.map((row) => row.person.id),
                { type: "welcome_message", notes: "Bulk welcome follow-up." },
              );
              setSelected(new Set());
            }}
          >
            Create welcome tasks
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          <p className="text-xs text-muted-foreground">
            People who opted out are skipped automatically.
          </p>
        </div>
      ) : null}

      <VisitorTable
        rows={rows}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onAssign={(row) => setAssigning(row)}
        onStopFollowUp={(row) => setClosing(row)}
        onPreferences={(row) => setPreferences(row)}
        canEdit={canEdit}
        toolbar={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone or email"
              className="w-full sm:w-64"
              aria-label="Search visitors"
            />
            <NativeSelect
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
              aria-label="Filter by assigned volunteer"
            >
              <NativeSelectOption value="">Anyone assigned</NativeSelectOption>
              <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
              {assignableTeam.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </>
        }
        emptyState={
          search || filter !== "all" || assigneeFilter ? (
            <NoResultsState
              context="visitors"
              onClear={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={UserPlusIcon}
              title="No visitors yet"
              description="Register the first visitor after a service, or open the welcome page for people to register themselves."
              action={
                <LinkButton size="sm" href="/visitors/new">
                  Register a visitor
                </LinkButton>
              }
            />
          )
        }
      />

      <AssignDialog
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
        team={assignableTeam}
        count={assigning === "bulk" ? selectedRows.length : 1}
        onConfirm={(teamMemberId) => {
          if (assigning === "bulk") {
            bulkAssign(
              selectedRows.map((row) => row.person.id),
              teamMemberId,
            );
            setSelected(new Set());
          } else if (assigning) {
            assign(assigning.person.id, teamMemberId);
          }
          setAssigning(null);
        }}
      />

      <CloseFollowUpDialog
        open={closing !== null}
        onOpenChange={(open) => !open && setClosing(null)}
        personName={closing ? displayName(closing.person) : ""}
        onConfirm={(reason, note, optOut) => {
          if (closing) stopFollowUp(closing.person.id, reason, note, optOut);
          setClosing(null);
        }}
      />

      {preferences ? (
        <ContactPreferencesDialog
          open
          onOpenChange={(open) => !open && setPreferences(null)}
          personName={displayName(preferences.person)}
          initial={{
            preferredMethod: preferences.person.contact.preferredMethod,
            permissionGranted: preferences.person.contact.permissionGranted,
            optedOut: preferences.person.contact.optedOut,
          }}
          onConfirm={(changes) => {
            updateContactPreferences(preferences.person.id, changes);
            setPreferences(null);
          }}
        />
      ) : null}
    </PageShell>
  );
}
