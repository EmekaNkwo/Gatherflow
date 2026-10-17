"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KanbanIcon, ListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, NoResultsState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { useIsMobile } from "@/hooks/use-mobile";
import { PipelineBoard } from "@/components/follow-ups/pipeline-board";
import { VisitorTable } from "@/components/visitors/visitor-table";
import {
  AssignDialog,
  CloseFollowUpDialog,
  ContactPreferencesDialog,
} from "@/components/visitors/visitor-dialogs";
import { displayName } from "@/lib/strings";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useVisitors } from "@/hooks/useVisitors";
import type { VisitorRow } from "@/services/visitors/selectors";

/**
 * The visitor journey: where each visitor is, from first visit to settled
 * in. On a phone, the stages stack as a list that folds open; on a wide
 * screen, a board, or the full table with its bulk actions.
 */
export default function FollowUpPipelinePage() {
  const params = useSearchParams();
  const now = useNow();
  const { assignableTeam, can } = useRole();

  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState<VisitorRow | null>(null);
  const [closing, setClosing] = useState<VisitorRow | null>(null);
  const [preferences, setPreferences] = useState<VisitorRow | null>(null);

  const isMobile = useIsMobile();
  const stageParam = params.get("stage") ?? undefined;

  const query = useMemo(
    () => ({
      search: search || undefined,
      assigneeId: assigneeFilter || undefined,
      stageId: stageParam,
    }),
    [search, assigneeFilter, stageParam],
  );

  const { board: columns, rows, counts, moveToStage, assign, stopFollowUp, updateContactPreferences } =
    useVisitors(query);

  if (!can("tasks.read.all")) {
    return (
      <PageShell>
        <RestrictedState section="The visitor journey" />
      </PageShell>
    );
  }

  const canEdit = can("visitors.write");
  const filtersApplied = Boolean(search || assigneeFilter || stageParam);

  const emptyState = filtersApplied ? (
    <NoResultsState context="visitors" />
  ) : (
    <EmptyState
      title="No visitors yet"
      description="When someone new is welcomed, they appear here at the start of the journey."
    />
  );

  const board = rows.length ? (
    <PipelineBoard
      columns={columns}
      now={now}
      canEdit={canEdit}
      onMove={(personId, stageId) => moveToStage(personId, stageId)}
    />
  ) : (
    emptyState
  );

  return (
    <PageShell>
      <PageHeader title="Visitor journey" description={journeySummary(counts)} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          className="h-11 w-full rounded-full sm:w-64"
          aria-label="Search the pipeline"
        />
        <NativeSelect
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          aria-label="Filter by follow-up owner"
          className="h-11 rounded-full"
        >
          <NativeSelectOption value="">Anyone looking after them</NativeSelectOption>
          <NativeSelectOption value="unassigned">Nobody yet</NativeSelectOption>
          {assignableTeam.map((member) => (
            <NativeSelectOption key={member.id} value={member.id}>
              {member.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {filtersApplied ? (
          <Button
            variant="ghost"
            size="lg"
            className="rounded-full"
            onClick={() => {
              setSearch("");
              setAssigneeFilter("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {isMobile ? (
        board
      ) : (
        <Tabs defaultValue="board">
          <TabsList>
            <TabsTrigger value="board" className="gap-1.5">
              <KanbanIcon className="size-3.5" />
              Board
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-1.5">
              <ListIcon className="size-3.5" />
              Table
            </TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="pt-2">
            {board}
          </TabsContent>

          <TabsContent value="table" className="pt-2">
            <VisitorTable
              rows={rows}
              selected={selected}
              onToggle={(personId) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (next.has(personId)) next.delete(personId);
                  else next.add(personId);
                  return next;
                })
              }
              onToggleAll={() =>
                setSelected((previous) =>
                  previous.size === rows.length
                    ? new Set()
                    : new Set(rows.map((row) => row.person.id)),
                )
              }
              onAssign={setAssigning}
              onStopFollowUp={setClosing}
              onPreferences={setPreferences}
              canEdit={canEdit}
              emptyState={emptyState}
            />
          </TabsContent>
        </Tabs>
      )}

      <AssignDialog
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
        team={assignableTeam}
        count={1}
        onConfirm={(teamMemberId) => {
          if (assigning) assign(assigning.person.id, teamMemberId);
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

/** One calm sentence: how many, and who still needs somebody. */
function journeySummary(counts: { total: number; awaitingAssignment: number; overdue: number }): string {
  const people = `${counts.total} ${counts.total === 1 ? "visitor" : "visitors"}`;
  const parts = [
    counts.awaitingAssignment ? `${counts.awaitingAssignment} still need somebody to look after them` : null,
    counts.overdue ? `${counts.overdue} with a follow-up running late` : null,
  ].filter(Boolean);
  return parts.length ? `${people} · ${parts.join(" · ")}` : `${people}, and everyone has somebody looking out for them.`;
}
