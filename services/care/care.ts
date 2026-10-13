import { nextReference } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import type { CareRecordId, IsoDate, PersonId, TeamMemberId } from "@/types/common";
import {
  CARE_STATUS_LABELS,
  type CareCategory,
  type CareRecord,
  type CareStatus,
} from "@/types/care";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";

export interface CreateCareRecordInput {
  personId: PersonId;
  category: CareCategory;
  /** Short, non-sensitive description. */
  summary: string;
  assigneeId?: TeamMemberId;
  receivedAt: IsoDate;
  nextAction?: string;
  nextActionDate?: IsoDate;
  /** Optional first restricted note. */
  note?: string;
}

/**
 * Pastoral-care records.
 *
 * Every activity entry written here is `restricted`, so care work never
 * appears in the dashboard feed, global search or any export.
 */
export function createCareRecord(
  snapshot: ChurchSnapshot,
  input: CreateCareRecordInput,
  ctx: CommandContext,
): Result<CommandResult & { careRecordId: CareRecordId }> {
  const person = findPerson(snapshot, input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  const summary = input.summary.trim();
  if (!summary) return err("Add a short description of the request.", "invalid");

  const record: CareRecord = {
    id: ctx.id("care"),
    reference: nextReference(
      "CARE",
      snapshot.careRecords.map((entry) => entry.reference),
      3,
    ),
    personId: input.personId,
    category: input.category,
    summary,
    assigneeId: input.assigneeId,
    receivedAt: input.receivedAt,
    nextAction: input.nextAction?.trim() || undefined,
    nextActionDate: input.nextActionDate,
    status: input.assigneeId ? "assigned" : "new",
    notes: input.note?.trim()
      ? [{ at: ctx.nowIso, by: ctx.actorId, text: input.note.trim(), visibility: "restricted" }]
      : [],
    appointments: [],
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  const next = patch(snapshot, { careRecords: [...snapshot.careRecords, record] });

  return ok({
    ...result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "care.created",
          category: "care",
          personId: input.personId,
          summary: `Pastoral-care record ${record.reference} opened.`,
          visibility: "restricted",
          meta: { careRecordId: record.id },
        }),
      ]),
      [],
      [`${record.reference} created.`],
    ),
    careRecordId: record.id,
  });
}

export interface UpdateCareRecordInput {
  status?: CareStatus;
  assigneeId?: TeamMemberId;
  nextAction?: string;
  nextActionDate?: IsoDate;
}

export function updateCareRecord(
  snapshot: ChurchSnapshot,
  recordId: CareRecordId,
  changes: UpdateCareRecordInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const record = snapshot.careRecords.find((entry) => entry.id === recordId);
  if (!record) return err("That care record no longer exists.", "not_found");

  const next = patch(snapshot, {
    careRecords: replaceById(snapshot.careRecords, recordId, (entry) => ({
      ...entry,
      status: changes.status ?? entry.status,
      assigneeId: changes.assigneeId ?? entry.assigneeId,
      nextAction:
        changes.nextAction === undefined ? entry.nextAction : changes.nextAction.trim() || undefined,
      nextActionDate: changes.nextActionDate ?? entry.nextActionDate,
      updatedAt: ctx.nowIso,
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "care.updated",
          category: "care",
          personId: record.personId,
          summary: `${record.reference} updated${
            changes.status ? ` — ${CARE_STATUS_LABELS[changes.status].toLowerCase()}` : ""
          }.`,
          visibility: "restricted",
          meta: { careRecordId: record.id },
        }),
      ]),
      [],
      [`${record.reference} updated.`],
    ),
  );
}

export function addCareNote(
  snapshot: ChurchSnapshot,
  recordId: CareRecordId,
  text: string,
  ctx: CommandContext,
): Result<CommandResult> {
  const record = snapshot.careRecords.find((entry) => entry.id === recordId);
  if (!record) return err("That care record no longer exists.", "not_found");

  const note = text.trim();
  if (!note) return err("Write something before saving the note.", "invalid");

  const next = patch(snapshot, {
    careRecords: replaceById(snapshot.careRecords, recordId, (entry) => ({
      ...entry,
      notes: [
        ...entry.notes,
        { at: ctx.nowIso, by: ctx.actorId, text: note, visibility: "restricted" as const },
      ],
      updatedAt: ctx.nowIso,
    })),
  });

  return ok(result(next, [], ["Restricted note added."]));
}

export function scheduleCareAppointment(
  snapshot: ChurchSnapshot,
  recordId: CareRecordId,
  input: { date: IsoDate; time: string; location?: string },
  ctx: CommandContext,
): Result<CommandResult> {
  const record = snapshot.careRecords.find((entry) => entry.id === recordId);
  if (!record) return err("That care record no longer exists.", "not_found");

  const next = patch(snapshot, {
    careRecords: replaceById(snapshot.careRecords, recordId, (entry) => ({
      ...entry,
      appointments: [
        ...entry.appointments,
        {
          id: ctx.id("appointment"),
          date: input.date,
          time: input.time,
          location: input.location?.trim() || undefined,
          status: "scheduled" as const,
        },
      ],
      status: entry.status === "new" ? "in_progress" : entry.status,
      updatedAt: ctx.nowIso,
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "care.updated",
          category: "care",
          personId: record.personId,
          summary: `Appointment scheduled for ${record.reference}.`,
          visibility: "restricted",
          meta: { careRecordId: record.id },
        }),
      ]),
      [],
      ["Appointment scheduled."],
    ),
  );
}

export function setAppointmentStatus(
  snapshot: ChurchSnapshot,
  recordId: CareRecordId,
  appointmentId: string,
  status: "scheduled" | "completed" | "cancelled",
  ctx: CommandContext,
): Result<CommandResult> {
  const record = snapshot.careRecords.find((entry) => entry.id === recordId);
  if (!record) return err("That care record no longer exists.", "not_found");

  const next = patch(snapshot, {
    careRecords: replaceById(snapshot.careRecords, recordId, (entry) => ({
      ...entry,
      appointments: entry.appointments.map((appointment) =>
        appointment.id === appointmentId ? { ...appointment, status } : appointment,
      ),
      updatedAt: ctx.nowIso,
    })),
  });

  return ok(result(next, [], ["Appointment updated."]));
}

/** Open care work, for the care dashboard. */
export function openCareRecords(snapshot: ChurchSnapshot): CareRecord[] {
  return snapshot.careRecords
    .filter((record) => !["resolved", "closed"].includes(record.status))
    .sort((left, right) => (left.receivedAt < right.receivedAt ? 1 : -1));
}
