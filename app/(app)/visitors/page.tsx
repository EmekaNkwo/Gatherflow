"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRightIcon, DownloadIcon, UserPlusIcon } from "lucide-react";
import { cn } from "cn";
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
import { useRole } from "@/hooks/useRole";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisitors } from "@/hooks/useVisitors";
import {
  VISITOR_FILTER_LABELS,
  type VisitorFilter,
  type VisitorRow,
} from "@/services/visitors/selectors";

const FILTERS = Object.keys(VISITOR_FILTER_LABELS) as VisitorFilter[];
/** The views people reach for; the rest are one tap away in "More". */
const MAIN_FILTERS: readonly VisitorFilter[] = ["all", "first_time", "awaiting_assignment", "overdue"];
const SHORT_LABELS: Partial<Record<VisitorFilter, string>> = {
  all: "Everyone",
  first_time: "First visit",
  awaiting_assignment: "Nobody assigned",
  overdue: "Follow-up late",
};

/**
 * Visitors: the people who have come recently. Four common views up front,
 * the rest under "More"; people as a list on a phone, the full table (with
 * bulk actions) on a wide screen.
 */
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

  const { assignableTeam, can } = useRole();
  const isMobile = useIsMobile();
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
        description={
          counts.awaitingAssignment
            ? `${counts.total} people · ${counts.awaitingAssignment} still need somebody to say hello`
            : `${counts.total} people`
        }
        actions={
          <>
            {can("exports.run") && !isMobile ? (
              <Button variant="ghost" onClick={() => exportCsv()} className="gap-1.5 rounded-full">
                <DownloadIcon />
                Export
              </Button>
            ) : null}
            {canEdit ? (
              <LinkButton className="gap-1.5 rounded-full" href="/visitors/quick">
                <UserPlusIcon />
                Welcome someone new
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {MAIN_FILTERS.map((option) => (
          <Button
            key={option}
            variant={filter === option ? "default" : "outline"}
            className="h-10 rounded-full"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {SHORT_LABELS[option]}
          </Button>
        ))}
        <NativeSelect
          aria-label="More views"
          value={MAIN_FILTERS.includes(filter) ? "" : filter}
          onChange={(event) => setFilter((event.target.value || "all") as VisitorFilter)}
          className={cn("h-10 rounded-full", !MAIN_FILTERS.includes(filter) && "border-primary")}
        >
          <NativeSelectOption value="">More…</NativeSelectOption>
          {FILTERS.filter((option) => !MAIN_FILTERS.includes(option)).map((option) => (
            <NativeSelectOption key={option} value={option}>
              {VISITOR_FILTER_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
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

      {isMobile ? (
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or phone"
            className="h-11 rounded-full"
            aria-label="Search visitors"
          />
          {rows.length ? (
            <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
              {rows.map((row) => (
                <li key={row.person.id}>
                  <Link
                    href={`/visitors/${row.person.id}`}
                    className="flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{displayName(row.person)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {row.statusLabel}
                        {row.assigneeName ? ` · ${row.assigneeName}` : " · nobody assigned"}
                      </span>
                    </span>
                    {row.hasOverdue ? (
                      <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-foreground">
                        Late
                      </span>
                    ) : null}
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">Nobody matches this view.</p>
          )}
        </div>
      ) : (
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
              description="Welcome the first person after a service, or put the welcome page's QR code where people will see it."
              action={
                <LinkButton size="sm" href="/visitors/quick">
                  Welcome someone new
                </LinkButton>
              }
            />
          )
        }
      />
      )}

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
