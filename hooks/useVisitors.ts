"use client";

import { useCallback, useMemo } from "react";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { ContactMethod, PersonId, StageId, TeamMemberId } from "@/types/common";
import type { ClosureReason } from "@/types/person";
import {
  findPotentialDuplicates,
  type DuplicateCandidateInput,
  type DuplicateMatch,
} from "@/services/visitors/duplicates";
import {
  assignVisitor,
  closeFollowUp,
  setContactPreferences,
  setStage,
  orderedStages,
} from "@/services/visitors/pipeline";
import {
  registerVisitor,
  recordReturnVisit,
  type RegisterVisitorInput,
} from "@/services/visitors/registration";
import {
  selectVisitors,
  visitorsByStage,
  VISITOR_EXPORT_COLUMNS,
  type VisitorQuery,
  type VisitorRow,
} from "@/services/visitors/selectors";
import { recordMembershipInterest } from "@/services/members/membership";
import { createTasksForPeople } from "@/services/follow-ups/tasks";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/**
 * Visitor registration, the pipeline and the directory.
 *
 * Components get data and callbacks from here; none of the rules about
 * stages, consent or duplicates live in the UI.
 */
export function useVisitors(query: VisitorQuery = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { run } = useCommand();

  const rows = useMemo(() => selectVisitors(snapshot, query, now), [snapshot, query, now]);
  const board = useMemo(() => visitorsByStage(snapshot, now, query), [snapshot, now, query]);
  const stages = useMemo(() => orderedStages(snapshot.settings), [snapshot.settings]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      awaitingAssignment: rows.filter((row) => !row.person.visitor?.assignedTo && !row.closedReason)
        .length,
      overdue: rows.filter((row) => row.hasOverdue).length,
      optedOut: rows.filter((row) => row.optedOut).length,
    }),
    [rows],
  );

  const register = useCallback(
    (input: RegisterVisitorInput) =>
      run((snap, ctx) => registerVisitor(snap, input, ctx), {
        undoLabel: "visitor registration",
      }),
    [run],
  );

  const assign = useCallback(
    (personId: PersonId, teamMemberId: TeamMemberId | undefined) =>
      run((snap, ctx) => assignVisitor(snap, personId, teamMemberId, ctx)),
    [run],
  );

  const moveToStage = useCallback(
    (personId: PersonId, stageId: StageId) =>
      run((snap, ctx) => setStage(snap, personId, stageId, ctx), { undoLabel: "stage change" }),
    [run],
  );

  const stopFollowUp = useCallback(
    (personId: PersonId, reason: ClosureReason, note?: string, optOut?: boolean) =>
      run((snap, ctx) => closeFollowUp(snap, { personId, reason, note, optOut }, ctx), {
        undoLabel: "closing the follow-up",
      }),
    [run],
  );

  const updateContactPreferences = useCallback(
    (
      personId: PersonId,
      changes: {
        preferredMethod?: ContactMethod;
        permissionGranted?: boolean;
        optedOut?: boolean;
        optOutReason?: string;
      },
    ) => run((snap, ctx) => setContactPreferences(snap, { personId, ...changes }, ctx)),
    [run],
  );

  const expressMembershipInterest = useCallback(
    (personId: PersonId) => run((snap, ctx) => recordMembershipInterest(snap, personId, ctx)),
    [run],
  );

  const recordAnotherVisit = useCallback(
    (personId: PersonId, sessionId: string) =>
      run((snap, ctx) => recordReturnVisit(snap, personId, sessionId, ctx)),
    [run],
  );

  const bulkAssign = useCallback(
    (personIds: readonly PersonId[], teamMemberId: TeamMemberId) =>
      run((snap, ctx) => {
        let current = snap;
        let assignedCount = 0;
        for (const personId of personIds) {
          const outcome = assignVisitor(current, personId, teamMemberId, ctx);
          if (outcome.ok) {
            current = outcome.value.snapshot;
            assignedCount += 1;
          }
        }
        return {
          ok: true as const,
          value: {
            snapshot: current,
            events: [],
            notices: [`${assignedCount} visitor${assignedCount === 1 ? "" : "s"} assigned.`],
          },
        };
      }, { undoLabel: "bulk assignment" }),
    [run],
  );

  const bulkCreateTasks = useCallback(
    (
      personIds: readonly PersonId[],
      input: Parameters<typeof createTasksForPeople>[2],
    ) =>
      run(
        (snap, ctx) => ({
          ok: true as const,
          value: createTasksForPeople(snap, personIds, input, ctx),
        }),
        { undoLabel: "bulk task creation" },
      ),
    [run],
  );

  const findDuplicates = useCallback(
    (input: DuplicateCandidateInput): DuplicateMatch[] =>
      findPotentialDuplicates(snapshot.people, input),
    [snapshot.people],
  );

  const exportCsv = useCallback(
    (exportRows: readonly VisitorRow[] = rows) => {
      downloadCsv(
        `gatherflow-visitors-${now.toISOString().slice(0, 10)}.csv`,
        toCsv(exportRows, VISITOR_EXPORT_COLUMNS),
      );
    },
    [rows, now],
  );

  return {
    rows,
    board,
    stages,
    counts,
    register,
    assign,
    bulkAssign,
    bulkCreateTasks,
    moveToStage,
    stopFollowUp,
    updateContactPreferences,
    expressMembershipInterest,
    recordAnotherVisit,
    findDuplicates,
    exportCsv,
  };
}

/** A single visitor record with everything the profile page needs. */
export function useVisitor(personId: PersonId) {
  const snapshot = useSnapshot();
  const now = useNow();

  return useMemo(() => {
    const rows = selectVisitors(snapshot, { filter: "all" }, now);
    return rows.find((row) => row.person.id === personId);
  }, [snapshot, now, personId]);
}
