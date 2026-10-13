"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KanbanIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, NoResultsState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { PipelineBoard } from "@/components/follow-ups/pipeline-board";
import { VisitorTable } from "@/components/visitors/visitor-table";
import {
  AssignDialog,
  CloseFollowUpDialog,
  ContactPreferencesDialog,
} from "@/components/visitors/visitor-dialogs";
import { displayName } from "@/lib/strings";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";
import { useVisitors } from "@/hooks/useVisitors";
import type { VisitorRow } from "@/services/visitors/selectors";

/**
 * The follow-up pipeline: the same records as a board or a table, because a
 * coordinator triaging on a phone wants different things from one planning
 * the week at a desk.
 */
export default function FollowUpPipelinePage() {
  const params = useSearchParams();
  const now = useNow();
  const { assignableTeam, can } = useDemoRole();

  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState<VisitorRow | null>(null);
  const [closing, setClosing] = useState<VisitorRow | null>(null);
  const [preferences, setPreferences] = useState<VisitorRow | null>(null);

  const stageParam = params.get("stage") ?? undefined;

  const query = useMemo(
    () => ({
      search: search || undefined,
      assigneeId: assigneeFilter || undefined,
      stageId: stageParam,
    }),
    [search, assigneeFilter, stageParam],
  );

  const { board, rows, counts, moveToStage, assign, stopFollowUp, updateContactPreferences } =
    useVisitors(query);

  if (!can("tasks.read.all")) {
    return (
      <PageShell>
        <RestrictedState section="The follow-up pipeline" />
      </PageShell>
    );
  }

  const canEdit = can("visitors.write");
  const filtersApplied = Boolean(search || assigneeFilter || stageParam);

  return (
    <PageShell>
      <PageHeader
        title="Follow-up pipeline"
        description={`${counts.total} visitor records · ${counts.awaitingAssignment} waiting for an owner · ${counts.overdue} with overdue follow-up. Stages are configurable in Settings.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search visitors"
          className="w-full sm:w-64"
          aria-label="Search the pipeline"
        />
        <NativeSelect
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          aria-label="Filter by follow-up owner"
        >
          <NativeSelectOption value="">Anyone assigned</NativeSelectOption>
          <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
          {assignableTeam.map((member) => (
            <NativeSelectOption key={member.id} value={member.id}>
              {member.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {filtersApplied ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setAssigneeFilter("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board" className="gap-1.5">
            <KanbanIcon className="size-3.5" />
            Board
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-1.5">
            <TableIcon className="size-3.5" />
            Table
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          {rows.length ? (
            <PipelineBoard
              columns={board}
              now={now}
              canEdit={canEdit}
              onMove={(personId, stageId) => moveToStage(personId, stageId)}
            />
          ) : filtersApplied ? (
            <NoResultsState context="visitors" />
          ) : (
            <EmptyState
              title="No visitors in the pipeline"
              description="Register a visitor and they will appear in the first stage."
            />
          )}
        </TabsContent>

        <TabsContent value="table">
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
            emptyState={
              filtersApplied ? (
                <NoResultsState context="visitors" />
              ) : (
                <EmptyState
                  title="No visitors in the pipeline"
                  description="Register a visitor and they will appear in the first stage."
                />
              )
            }
          />
        </TabsContent>
      </Tabs>

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
