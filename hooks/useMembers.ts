"use client";

import { useCallback, useMemo } from "react";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { HouseholdId, IsoDate, PersonId } from "@/types/common";
import type { EmergencyContact, MembershipStatus } from "@/types/person";
import {
  changeMembershipStatus,
  recordOrientationCompleted,
  registerMember,
  setEmergencyContact,
  setRequestedContact,
  type RegisterMemberInput,
} from "@/services/members/membership";
import {
  MEMBER_EXPORT_COLUMNS,
  groupParticipation,
  membershipBreakdown,
  selectMembers,
  type MemberQuery,
  type MemberRow,
} from "@/services/members/selectors";
import {
  correctPerson,
  createHousehold,
  deletePerson,
  setHousehold,
  type PersonCorrection,
} from "@/services/people/people";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/** Member directory, membership changes and record corrections. */
export function useMembers(query: MemberQuery = {}) {
  const snapshot = useSnapshot();
  const now = useNow();
  const { run } = useCommand();

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
      run((snap, ctx) => registerMember(snap, input, ctx), { undoLabel: "membership registration" }),
    [run],
  );

  const changeStatus = useCallback(
    (personId: PersonId, status: MembershipStatus, reason?: string) =>
      run((snap, ctx) => changeMembershipStatus(snap, personId, status, reason, ctx), {
        undoLabel: "status change",
      }),
    [run],
  );

  const completeOrientation = useCallback(
    (personId: PersonId) => run((snap, ctx) => recordOrientationCompleted(snap, personId, ctx)),
    [run],
  );

  const correct = useCallback(
    (personId: PersonId, changes: PersonCorrection) =>
      run((snap, ctx) => correctPerson(snap, personId, changes, ctx), {
        undoLabel: "record correction",
      }),
    [run],
  );

  const remove = useCallback(
    (personId: PersonId, reason?: string) =>
      run((snap, ctx) => deletePerson(snap, personId, reason, ctx), {
        undoLabel: "record deletion",
      }),
    [run],
  );

  const saveEmergencyContact = useCallback(
    (personId: PersonId, contact: EmergencyContact | undefined) =>
      run((snap, ctx) => setEmergencyContact(snap, personId, contact, ctx)),
    [run],
  );

  const markRequestedContact = useCallback(
    (personId: PersonId, requested: boolean) =>
      run((snap, ctx) => setRequestedContact(snap, personId, requested, ctx)),
    [run],
  );

  const addHousehold = useCallback(
    (input: { name: string; area?: string; primaryContactId?: PersonId }) =>
      run((snap, ctx) => createHousehold(snap, input, ctx)),
    [run],
  );

  const assignHousehold = useCallback(
    (personId: PersonId, householdId: HouseholdId | undefined) =>
      run((snap, ctx) => setHousehold(snap, personId, householdId, ctx)),
    [run],
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
