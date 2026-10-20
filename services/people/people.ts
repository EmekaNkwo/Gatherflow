import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { HouseholdId, PersonId } from "@/types/common";
import type { Household, Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { activity, findPerson, patch, withActivity, withPerson } from "../core/snapshot";

/** Fields a correction may change. Membership and visitor state have their own commands. */
export interface PersonCorrection {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  ageGroup?: Person["ageGroup"];
  interests?: readonly string[];
  householdId?: HouseholdId | null;
  notes?: string;
}

/** Record correction workflow: edits are applied and the change is logged. */
export function correctPerson(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  changes: PersonCorrection,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  const trimmedFirst = changes.firstName?.trim();
  const trimmedLast = changes.lastName?.trim();
  if (changes.firstName !== undefined && !trimmedFirst) {
    return err("A first name is required.", "invalid");
  }
  if (changes.lastName !== undefined && !trimmedLast) {
    return err("A last name is required.", "invalid");
  }
  if (changes.householdId && !snapshot.households.some((entry) => entry.id === changes.householdId)) {
    return err("That household no longer exists. Choose another, or none.", "not_found");
  }

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      firstName: trimmedFirst ?? entry.firstName,
      lastName: trimmedLast ?? entry.lastName,
      preferredName:
        changes.preferredName === undefined
          ? entry.preferredName
          : changes.preferredName.trim() || undefined,
      phone: changes.phone === undefined ? entry.phone : changes.phone.trim() || undefined,
      email: changes.email === undefined ? entry.email : changes.email.trim() || undefined,
      ageGroup: changes.ageGroup ?? entry.ageGroup,
      interests: changes.interests ?? entry.interests,
      householdId:
        changes.householdId === undefined
          ? entry.householdId
          : (changes.householdId ?? undefined),
      visitor:
        entry.visitor && changes.notes !== undefined
          ? { ...entry.visitor, notes: changes.notes.trim() || undefined }
          : entry.visitor,
    }),
    ctx,
  );

  const changed = Object.keys(changes).filter(
    (key) => changes[key as keyof PersonCorrection] !== undefined,
  );

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.contact_preference_changed",
          category: "visitor",
          personId,
          summary: `Record details updated for ${displayName(person)} (${changed.join(", ")}).`,
        }),
      ]),
      [],
      ["Record updated."],
    ),
  );
}

/**
 * Deletion workflow.
 *
 * Everything belonging to the person goes with them — attendance, tasks,
 * messages, care records and timeline entries. The audit entry left behind
 * deliberately contains no personal details.
 */
export function deletePerson(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  reason: string | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  const next = patch(snapshot, {
    people: snapshot.people.filter((entry) => entry.id !== personId),
    tasks: snapshot.tasks.filter((task) => task.personId !== personId),
    attendance: snapshot.attendance.filter((row) => row.personId !== personId),
    communications: snapshot.communications.filter((entry) => entry.personId !== personId),
    careRecords: snapshot.careRecords.filter((entry) => entry.personId !== personId),
    activity: snapshot.activity.filter((entry) => entry.personId !== personId),
    groups: snapshot.groups.map((group) =>
      group.members.some((member) => member.personId === personId)
        ? {
            ...group,
            members: group.members.filter((member) => member.personId !== personId),
            leaderId: group.leaderId === personId ? undefined : group.leaderId,
          }
        : group,
    ),
    households: snapshot.households.map((household) =>
      household.primaryContactId === personId
        ? { ...household, primaryContactId: undefined }
        : household,
    ),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "system.reset",
          category: "system",
          summary: `A person record and all of its history were deleted${reason ? ` — ${reason}` : ""}.`,
        }),
      ]),
      [],
      ["Record deleted."],
    ),
  );
}

export function createHousehold(
  snapshot: ChurchSnapshot,
  input: { name: string; area?: string; primaryContactId?: PersonId },
  ctx: CommandContext,
): Result<CommandResult & { householdId: HouseholdId }> {
  const name = input.name.trim();
  if (!name) return err("Give the household a name.", "invalid");

  const household: Household = {
    id: ctx.id("household"),
    name,
    area: input.area?.trim() || undefined,
    primaryContactId: input.primaryContactId,
    createdAt: ctx.nowIso,
  };

  return ok({
    ...result(patch(snapshot, { households: [...snapshot.households, household] }), [], [
      `${household.name} created.`,
    ]),
    householdId: household.id,
  });
}

export function setHousehold(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  householdId: HouseholdId | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");
  if (householdId && !snapshot.households.some((entry) => entry.id === householdId)) {
    return err("That household no longer exists.", "not_found");
  }

  return ok(
    result(
      withPerson(snapshot, personId, (entry) => ({ ...entry, householdId }), ctx),
      [],
      ["Household updated."],
    ),
  );
}
