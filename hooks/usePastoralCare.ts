"use client";

import { useCallback, useMemo } from "react";
import { canViewCare } from "@/lib/permissions";
import type { CareRecordId, IsoDate, PersonId } from "@/types/common";
import type { CareStatus } from "@/types/care";
import {
  openCareRecords,
  type CreateCareRecordInput,
  type UpdateCareRecordInput,
} from "@/services/care/care";
import { useSessionStore } from "@/stores/session-store";
import { useCommand, useSnapshot } from "./use-church-data";

/**
 * Restricted pastoral-care workflow.
 *
 * When the signed-in role cannot read care records, this hook returns
 * nothing at all — the UI has no data to leak, rather than relying on the
 * page to remember to hide it.
 */
export function usePastoralCare() {
  const snapshot = useSnapshot();
  const { dispatch } = useCommand();
  const role = useSessionStore((state) => state.role);
  const authorised = canViewCare(role);

  const records = useMemo(() => {
    if (!authorised) return [];
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
    const teamById = new Map(snapshot.team.map((member) => [member.id, member]));
    return [...snapshot.careRecords]
      .sort((left, right) => (left.receivedAt < right.receivedAt ? 1 : -1))
      .map((record) => ({
        record,
        person: peopleById.get(record.personId),
        assignee: record.assigneeId ? teamById.get(record.assigneeId) : undefined,
      }));
  }, [snapshot, authorised]);

  const open = useMemo(
    () => (authorised ? openCareRecords(snapshot) : []),
    [snapshot, authorised],
  );

  const appointments = useMemo(() => {
    if (!authorised) return [];
    return snapshot.careRecords
      .flatMap((record) =>
        record.appointments
          .filter((appointment) => appointment.status === "scheduled")
          .map((appointment) => ({ record, appointment })),
      )
      .sort((left, right) => (left.appointment.date < right.appointment.date ? -1 : 1));
  }, [snapshot, authorised]);

  const create = useCallback(
    (input: CreateCareRecordInput) => dispatch("care.create", input),
    [dispatch],
  );

  const update = useCallback(
    (recordId: CareRecordId, changes: UpdateCareRecordInput) =>
      dispatch("care.update", { recordId, changes }),
    [dispatch],
  );

  const setStatus = useCallback(
    (recordId: CareRecordId, status: CareStatus) =>
      dispatch("care.update", { recordId, changes: { status } }),
    [dispatch],
  );

  const addNote = useCallback(
    (recordId: CareRecordId, text: string) => dispatch("care.addNote", { recordId, text }),
    [dispatch],
  );

  const scheduleAppointment = useCallback(
    (recordId: CareRecordId, input: { date: IsoDate; time: string; location?: string }) =>
      dispatch("care.scheduleAppointment", { recordId, input }),
    [dispatch],
  );

  const updateAppointment = useCallback(
    (
      recordId: CareRecordId,
      appointmentId: string,
      status: "scheduled" | "completed" | "cancelled",
    ) => dispatch("care.setAppointmentStatus", { recordId, appointmentId, status }),
    [dispatch],
  );

  return {
    authorised,
    records,
    open,
    appointments,
    create,
    update,
    setStatus,
    addNote,
    scheduleAppointment,
    updateAppointment,
  };
}

/** Care records for one person — still gated on the care capability. */
export function usePersonCareRecords(personId: PersonId) {
  const { authorised, records } = usePastoralCare();
  return useMemo(
    () => (authorised ? records.filter((entry) => entry.record.personId === personId) : []),
    [authorised, records, personId],
  );
}
