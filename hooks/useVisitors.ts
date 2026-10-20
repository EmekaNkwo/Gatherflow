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
  closureStage,
  isAwaitingAssignment,
  isTerminalStage,
  orderedStages,
} from "@/services/visitors/pipeline";
import type { Person } from "@/types/person";
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
import { useRole } from "./useRole";

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
      /** Shown beside "total": people who became members are still listed. */
      becameMembers: rows.filter((row) => Boolean(row.person.member)).length,
      // The one shared definition, so this always matches the dashboard.
      awaitingAssignment: rows.filter((row) => isAwaitingAssignment(snapshot.settings, row.person))
        .length,
      overdue: rows.filter((row) => row.hasOverdue).length,
      optedOut: rows.filter((row) => row.optedOut).length,
    }),
    [rows, snapshot.settings],
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

  const reopenFollowUp = useCallback(
    (personId: PersonId, stageId?: StageId) =>
      dispatch("visitor.reopenFollowUp", { personId, stageId }, { undoLabel: "reopening the follow-up" }),
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
    reopenFollowUp,
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

/** Actions offered on one visitor, from the profile, the board or a table. */
export type VisitorActionName = "assign" | "preferences" | "stop" | "reopen" | "move" | "membership";

/**
 * Whether to offer an action for this visitor: the capability and ownership
 * of the command it dispatches (`canRun`), plus the state that command would
 * refuse — nobody is offered "stop" on a stopped follow-up, or a helper for
 * somebody who asked not to be contacted.
 */
export function useVisitorActionGate(): (action: VisitorActionName, person: Person) => boolean {
  const snapshot = useSnapshot();
  const { canRun } = useRole();

  return useCallback(
    (action: VisitorActionName, person: Person) => {
      const visitor = person.visitor;
      const personId = person.id;
      const finished = Boolean(visitor?.closure) || (visitor ? isTerminalStage(snapshot.settings, visitor.stageId) : false);
      switch (action) {
        case "assign":
          return Boolean(visitor) && !person.member && !visitor?.closure && !person.contact.optedOut &&
            canRun("visitor.assign", { personId });
        case "preferences":
          return canRun("visitor.setContactPreferences", { personId });
        case "stop":
          return Boolean(visitor) && !finished && canRun("visitor.closeFollowUp", { personId, reason: "paused" });
        case "reopen":
          return Boolean(visitor) && finished && !person.member && !person.contact.optedOut &&
            canRun("visitor.reopenFollowUp", { personId });
        case "move":
          return Boolean(visitor) && !visitor?.closure &&
            canRun("visitor.setStage", { personId, stageId: visitor?.stageId ?? "" });
        case "membership":
          return Boolean(visitor) && !person.member && canRun("visitor.recordMembershipInterest", { personId });
        default:
          return false;
      }
    },
    [snapshot.settings, canRun],
  );
}

/** The id of the stage that means "follow-up stopped", if the church has one. */
export function useClosedStageId(): string | undefined {
  const snapshot = useSnapshot();
  return useMemo(() => closureStage(snapshot.settings)?.id, [snapshot.settings]);
}
