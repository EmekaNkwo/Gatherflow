import { nextReference } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { ContactMethod, IsoDate, PersonId } from "@/types/common";
import {
  MEMBERSHIP_STATUS_LABELS,
  type EmergencyContact,
  type MembershipStatus,
  type Person,
} from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, findPerson, patch, withActivity, withPerson } from "../core/snapshot";
import { advanceStage } from "../visitors/pipeline";

export interface RegisterMemberInput {
  /** Existing visitor to convert. Omit to create a brand-new member record. */
  personId?: PersonId;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  membershipDate: IsoDate;
  preferredServiceType?: string;
  preferredMethod?: ContactMethod;
  permissionGranted?: boolean;
  householdId?: string;
}

function nextMemberReference(snapshot: ChurchSnapshot): string {
  return nextReference(
    "MEM",
    snapshot.people.flatMap((person) => (person.member ? [person.member.reference] : [])),
  );
}

/**
 * Registers a member — either by confirming an existing visitor or by
 * creating a new record.
 *
 * Converting a visitor keeps the same person id, so their attendance,
 * follow-up history and timeline all carry over.
 */
export function registerMember(
  snapshot: ChurchSnapshot,
  input: RegisterMemberInput,
  ctx: CommandContext,
): Result<CommandResult & { personId: PersonId }> {
  const reference = nextMemberReference(snapshot);

  if (input.personId) {
    const person = findPerson(snapshot, input.personId);
    if (!person) return err("That person is no longer in the directory.", "not_found");
    if (person.member) {
      return err(`${displayName(person)} is already a member (${person.member.reference}).`, "duplicate");
    }

    // Membership can be recorded without every earlier milestone: someone
    // may join after one visit, or after attending for years.
    const stage = advanceStage(snapshot.settings, person, "membership_orientation");

    let next = withPerson(
      snapshot,
      input.personId,
      (entry) => ({
        ...entry,
        kind: "member",
        phone: input.phone?.trim() || entry.phone,
        email: input.email?.trim() || entry.email,
        householdId: input.householdId ?? entry.householdId,
        visitor: entry.visitor
          ? {
              ...entry.visitor,
              stageId: stage ?? entry.visitor.stageId,
              stageUpdatedAt: stage ? ctx.nowIso : entry.visitor.stageUpdatedAt,
            }
          : entry.visitor,
        member: {
          reference,
          status: "new_member",
          membershipDate: input.membershipDate,
          preferredServiceType: input.preferredServiceType,
          statusHistory: [
            {
              status: "new_member" as MembershipStatus,
              changedAt: ctx.nowIso,
              changedBy: ctx.actorId,
              reason: "Membership registered",
            },
          ],
          requestedContact: false,
        },
      }),
      ctx,
    );

    next = withActivity(next, ctx, [
      activity(ctx, {
        type: "membership.registered",
        category: "membership",
        personId: person.id,
        summary: `${displayName(person)} became a member (${reference}).`,
      }),
    ]);

    const events: DomainEvent[] = [{ type: "member.registered", personId: person.id }];

    return ok({
      ...result(next, events, [`${displayName(person)} registered as a member (${reference}).`]),
      personId: person.id,
    });
  }

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName || !lastName) {
    return err("A first and last name are needed to create a member record.", "invalid");
  }

  const person: Person = {
    id: ctx.id("person"),
    kind: "member",
    firstName,
    lastName,
    preferredName: input.preferredName?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    ageGroup: "adult",
    householdId: input.householdId,
    interests: [],
    groupIds: [],
    contact: {
      preferredMethod: input.preferredMethod ?? "phone",
      permissionGranted: input.permissionGranted ?? true,
      optedOut: false,
    },
    member: {
      reference,
      status: "new_member",
      membershipDate: input.membershipDate,
      preferredServiceType: input.preferredServiceType,
      statusHistory: [
        {
          status: "new_member",
          changedAt: ctx.nowIso,
          changedBy: ctx.actorId,
          reason: "Membership registered",
        },
      ],
      requestedContact: false,
    },
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  const next = withActivity(patch(snapshot, { people: [...snapshot.people, person] }), ctx, [
    activity(ctx, {
      type: "membership.registered",
      category: "membership",
      personId: person.id,
      summary: `${displayName(person)} was registered as a member (${reference}).`,
    }),
  ]);

  return ok({
    ...result(next, [{ type: "member.registered", personId: person.id }], [
      `${displayName(person)} registered as a member (${reference}).`,
    ]),
    personId: person.id,
  });
}

/**
 * Changes a membership status, always with a reason, so a report can explain
 * why somebody appears in it. Nobody is marked inactive automatically.
 */
export function changeMembershipStatus(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  status: MembershipStatus,
  reason: string | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person?.member) return err("That member record no longer exists.", "not_found");
  if (person.member.status === status) return err("That is already the current status.", "unchanged");

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      member: entry.member
        ? {
            ...entry.member,
            status,
            statusHistory: [
              ...entry.member.statusHistory,
              { status, changedAt: ctx.nowIso, changedBy: ctx.actorId, reason },
            ],
          }
        : entry.member,
    }),
    ctx,
  );

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "membership.status_changed",
          category: "membership",
          personId,
          summary: `${displayName(person)}'s membership status changed to ${MEMBERSHIP_STATUS_LABELS[
            status
          ].toLowerCase()}${reason ? ` — ${reason}` : ""}.`,
        }),
      ]),
      [],
      [`Status updated to ${MEMBERSHIP_STATUS_LABELS[status]}.`],
    ),
  );
}

/** Records that someone asked about membership — this triggers rule D. */
export function recordMembershipInterest(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");
  if (person.member) return err(`${displayName(person)} is already a member.`, "duplicate");
  if (!person.visitor) return err("Only visitor records can express membership interest.", "invalid");
  if (person.visitor.membershipInterestAt) {
    return err("Membership interest has already been recorded.", "unchanged");
  }

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      visitor: entry.visitor
        ? { ...entry.visitor, membershipInterestAt: ctx.nowIso }
        : entry.visitor,
    }),
    ctx,
  );

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.membership_interest",
          category: "visitor",
          personId,
          summary: `${displayName(person)} asked about becoming a member.`,
        }),
      ]),
      [{ type: "visitor.membership_interest", personId }],
      ["Membership interest recorded."],
    ),
  );
}

/** Records attendance at a membership orientation session. */
export function recordOrientationCompleted(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  return ok(
    result(
      withActivity(snapshot, ctx, [
        activity(ctx, {
          type: "membership.orientation_completed",
          category: "membership",
          personId,
          summary: `${displayName(person)} completed membership orientation.`,
        }),
      ]),
      [],
      ["Membership orientation recorded."],
    ),
  );
}

/** Emergency contacts are restricted information, edited on their own. */
export function setEmergencyContact(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  contact: EmergencyContact | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person?.member) return err("That member record no longer exists.", "not_found");

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      member: entry.member ? { ...entry.member, emergencyContact: contact } : entry.member,
    }),
    ctx,
  );

  return ok(result(next, [], ["Emergency contact saved."]));
}

export function setRequestedContact(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  requested: boolean,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person?.member) return err("That member record no longer exists.", "not_found");

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      member: entry.member ? { ...entry.member, requestedContact: requested } : entry.member,
    }),
    ctx,
  );

  return ok(
    result(next, [], [requested ? "Marked as requesting contact." : "Contact request cleared."]),
  );
}
