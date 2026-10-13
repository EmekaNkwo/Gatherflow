"use client";

import { useCallback, useMemo } from "react";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { HouseholdId, IsoDate, PersonId } from "@/types/common";
import type { EmergencyContact, MembershipStatus } from "@/types/person";
import { type RegisterMemberInput } from "@/services/members/membership";
import {
  MEMBER_EXPORT_COLUMNS,
  groupParticipation,
  membershipBreakdown,
  selectMembers,
  type MemberQuery,
  type MemberRow,
} from "@/services/members/selectors";
import { type PersonCorrection } from "@/services/people/people";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/** Member directory, membership changes and record corrections. */
export function useMembers(query: MemberQuery = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { dispatch } = useCommand();

  const rows = useMemo(() => selectMembers(snapshot, query, now), [snapshot, query, now]);
  const breakdown = useMemo(() => membershipBreakdown(snapshot), [snapshot]);
  const participation = useMemo(() => groupParticipation(snapshot), [snapshot]);
  const households = useMemo(
    () =>
      snapshot.households.map((household) => ({
        household,
        members: snapshot.people.filter((person) => person.householdId === household.id),
      })),
    [snapshot],
  );

  const register = useCallback(
    (input: RegisterMemberInput) =>
      dispatch("member.register", input, { undoLabel: "membership registration" }),
    [dispatch],
  );

  const changeStatus = useCallback(
    (personId: PersonId, status: MembershipStatus, reason?: string) =>
      dispatch(
        "member.changeStatus",
        { personId, status, reason },
        { undoLabel: "status change" },
      ),
    [dispatch],
  );

  const completeOrientation = useCallback(
    (personId: PersonId) => dispatch("member.recordOrientationCompleted", { personId }),
    [dispatch],
  );

  const correct = useCallback(
    (personId: PersonId, changes: PersonCorrection) =>
      dispatch("person.correct", { personId, changes }, { undoLabel: "record correction" }),
    [dispatch],
  );

  const remove = useCallback(
    (personId: PersonId, reason?: string) =>
      dispatch("person.delete", { personId, reason }, { undoLabel: "record deletion" }),
    [dispatch],
  );

  const saveEmergencyContact = useCallback(
    (personId: PersonId, contact: EmergencyContact | undefined) =>
      dispatch("member.setEmergencyContact", { personId, contact }),
    [dispatch],
  );

  const markRequestedContact = useCallback(
    (personId: PersonId, requested: boolean) =>
      dispatch("member.setRequestedContact", { personId, requested }),
    [dispatch],
  );

  const addHousehold = useCallback(
    (input: { name: string; area?: string; primaryContactId?: PersonId }) =>
      dispatch("household.create", input),
    [dispatch],
  );

  const assignHousehold = useCallback(
    (personId: PersonId, householdId: HouseholdId | undefined) =>
      dispatch("person.setHousehold", { personId, householdId }),
    [dispatch],
  );

  const exportCsv = useCallback(
    (exportRows: readonly MemberRow[] = rows, today: IsoDate = now.toISOString().slice(0, 10)) => {
      downloadCsv(`gatherflow-members-${today}.csv`, toCsv(exportRows, MEMBER_EXPORT_COLUMNS));
    },
    [rows, now],
  );

  return {
    rows,
    breakdown,
    participation,
    households,
    register,
    changeStatus,
    completeOrientation,
    correct,
    remove,
    saveEmergencyContact,
    markRequestedContact,
    addHousehold,
    assignHousehold,
    exportCsv,
  };
}

export function useMember(personId: PersonId) {
  const snapshot = useSnapshot();
  const now = useNow();

  return useMemo(() => {
    const rows = selectMembers(snapshot, { filter: "all" }, now);
    return (
      rows.find((row) => row.person.id === personId) ??
      selectMembers(snapshot, { filter: "archived" }, now).find(
        (row) => row.person.id === personId,
      )
    );
  }, [snapshot, now, personId]);
}

/** Any person, member or visitor, for shared profile components. */
export function usePerson(personId: PersonId) {
  const snapshot = useSnapshot();
  return useMemo(
    () => snapshot.people.find((person) => person.id === personId),
    [snapshot.people, personId],
  );
}
