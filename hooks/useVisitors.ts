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
import { orderedStages } from "@/services/visitors/pipeline";
import { type RegisterVisitorInput } from "@/services/visitors/registration";
import {
  selectVisitors,
  visitorsByStage,
  VISITOR_EXPORT_COLUMNS,
  type VisitorQuery,
  type VisitorRow,
} from "@/services/visitors/selectors";
import type { createTasksForPeople } from "@/services/follow-ups/tasks";
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
  const { dispatch } = useCommand();

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
      dispatch("visitor.register", input, { undoLabel: "visitor registration" }),
    [dispatch],
  );

  const assign = useCallback(
    (personId: PersonId, teamMemberId: TeamMemberId | undefined) =>
      dispatch("visitor.assign", { personId, assigneeId: teamMemberId }),
    [dispatch],
  );

  const moveToStage = useCallback(
    (personId: PersonId, stageId: StageId) =>
      dispatch("visitor.setStage", { personId, stageId }, { undoLabel: "stage change" }),
    [dispatch],
  );

  const stopFollowUp = useCallback(
    (personId: PersonId, reason: ClosureReason, note?: string, optOut?: boolean) =>
      dispatch(
        "visitor.closeFollowUp",
        { personId, reason, note, optOut },
        { undoLabel: "closing the follow-up" },
      ),
    [dispatch],
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
    ) => dispatch("visitor.setContactPreferences", { personId, ...changes }),
    [dispatch],
  );

  const expressMembershipInterest = useCallback(
    (personId: PersonId) => dispatch("visitor.recordMembershipInterest", { personId }),
    [dispatch],
  );

  const recordAnotherVisit = useCallback(
    (personId: PersonId, sessionId: string) =>
      dispatch("visitor.recordReturnVisit", { personId, sessionId }),
    [dispatch],
  );

  const bulkAssign = useCallback(
    (personIds: readonly PersonId[], teamMemberId: TeamMemberId) =>
      dispatch(
        "visitor.bulkAssign",
        { personIds: [...personIds], assigneeId: teamMemberId },
        { undoLabel: "bulk assignment" },
      ),
    [dispatch],
  );

  const bulkCreateTasks = useCallback(
    (
      personIds: readonly PersonId[],
      input: Parameters<typeof createTasksForPeople>[2],
    ) =>
      dispatch(
        "task.createForPeople",
        { personIds: [...personIds], input },
        { undoLabel: "bulk task creation" },
      ),
    [dispatch],
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
