import { nextReference } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { foldForSearch } from "@/lib/person-search";
import { displayName, normaliseEmail, normalisePhone } from "@/lib/strings";
import type { FollowUpTask, FollowUpTaskType } from "@/types/follow-up";
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
import { isOpen } from "../follow-ups/tasks";
import { advanceStage, findStage } from "../visitors/pipeline";

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
 * How long a newly added member counts as "just added" for the duplicate
 * check. Long enough to catch a double tap or a retried request, short
 * enough that two genuinely different people who share a name and have no
 * contact details can still be added on different days.
 */
export const DUPLICATE_WINDOW_MINUTES = 10;

/**
 * A member record with the same name and the same contact details, created
 * in the last few minutes: almost certainly the same form sent twice.
 */
function findRecentDuplicate(
  snapshot: ChurchSnapshot,
  input: { firstName: string; lastName: string; phone?: string; email?: string },
  ctx: CommandContext,
): Person | undefined {
  const name = foldForSearch(`${input.firstName} ${input.lastName}`);
  const phone = normalisePhone(input.phone);
  const email = normaliseEmail(input.email);
  const since = ctx.now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000;

  return snapshot.people.find(
    (person) =>
      person.member !== undefined &&
      Date.parse(person.createdAt) >= since &&
      foldForSearch(`${person.firstName} ${person.lastName}`) === name &&
      normalisePhone(person.phone) === phone &&
      normaliseEmail(person.email) === email,
  );
}

/** Visitor follow-up that becoming a member makes unnecessary. */
const VISITOR_PIPELINE_TASK_TYPES: readonly FollowUpTaskType[] = [
  "welcome_message",
  "say_hello",
  "phone_call",
  "check_in",
  "service_invitation",
  "membership_orientation",
];

function hasCompletedOrientation(snapshot: ChurchSnapshot, personId: PersonId): boolean {
  return snapshot.activity.some(
    (entry) => entry.personId === personId && entry.type === "membership.orientation_completed",
  );
}

/**
 * Closes the visitor follow-up a new member no longer needs, so stale work
 * stops showing on Today:
 *
 * - an open orientation task is completed when orientation has already been
 *   recorded, and cancelled otherwise (orientation can still be noted on
 *   their member page);
 * - open welcome, say-hello, phone-call, check-in and service-invitation tasks are
 *   cancelled with a note saying why.
 *
 * Group invitations, pastoral contact and event follow-up stay open: they
 * still make sense for a member.
 */
function closeVisitorFollowUp(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  ctx: CommandContext,
): { snapshot: ChurchSnapshot; closed: number } {
  const orientationDone = hasCompletedOrientation(snapshot, personId);
  const stale = snapshot.tasks.filter(
    (task) =>
      task.personId === personId && isOpen(task) && VISITOR_PIPELINE_TASK_TYPES.includes(task.type),
  );
  if (!stale.length) return { snapshot, closed: 0 };

  const staleIds = new Set(stale.map((task) => task.id));
  const close = (task: FollowUpTask): FollowUpTask =>
    task.type === "membership_orientation" && orientationDone
      ? {
          ...task,
          status: "completed",
          outcome: "contacted",
          outcomeNote: "Orientation done; they became a member.",
          completedAt: ctx.nowIso,
          completedBy: ctx.actorId,
        }
      : {
          ...task,
          status: "cancelled",
          notes: `${task.notes ? `${task.notes}\n` : ""}Cancelled: they became a member.`,
        };

  const next = withActivity(
    patch(snapshot, {
      tasks: snapshot.tasks.map((task) => (staleIds.has(task.id) ? close(task) : task)),
    }),
    ctx,
    stale.map((task) =>
      activity(ctx, {
        type:
          task.type === "membership_orientation" && orientationDone
            ? "follow_up.completed"
            : "follow_up.cancelled",
        category: "follow_up",
        personId,
        summary: `${task.reference} closed — they became a member.`,
        meta: { taskId: task.id },
      }),
    ),
  );
  return { snapshot: next, closed: stale.length };
}

function closedNotice(closed: number): string[] {
  return closed
    ? [`${closed} visitor follow-up task${closed === 1 ? "" : "s"} closed, as they're now a member.`]
    : [];
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

  if (input.householdId && !snapshot.households.some((entry) => entry.id === input.householdId)) {
    return err("That household no longer exists. Choose another, or none.", "not_found");
  }

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

    const closed = closeVisitorFollowUp(next, person.id, ctx);
    const events: DomainEvent[] = [{ type: "member.registered", personId: person.id }];

    return ok({
      ...result(closed.snapshot, events, [
        `${displayName(person)} registered as a member (${reference}).`,
        ...closedNotice(closed.closed),
      ]),
      personId: person.id,
    });
  }

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName || !lastName) {
    return err("A first and last name are needed to create a member record.", "invalid");
  }

  const duplicate = findRecentDuplicate(
    snapshot,
    { firstName, lastName, phone: input.phone, email: input.email },
    ctx,
  );
  if (duplicate) {
    return err(
      `${displayName(duplicate)} was added a moment ago (${duplicate.member?.reference}), so we didn't add them twice.`,
      "duplicate",
    );
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

  // Interest moves them on to "exploring membership", unless they are
  // already further along (advanceStage never moves anyone backwards).
  const stageId = advanceStage(snapshot.settings, person, "membership_orientation");
  const stage = stageId ? findStage(snapshot.settings, stageId) : undefined;

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      visitor: entry.visitor
        ? {
            ...entry.visitor,
            membershipInterestAt: ctx.nowIso,
            stageId: stageId ?? entry.visitor.stageId,
            stageUpdatedAt: stageId ? ctx.nowIso : entry.visitor.stageUpdatedAt,
          }
        : entry.visitor,
    }),
    ctx,
  );

  const events: DomainEvent[] = [
    { type: "visitor.membership_interest", personId },
    ...(stageId ? [{ type: "visitor.stage_changed" as const, personId, stageId }] : []),
  ];

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.membership_interest",
          category: "visitor",
          personId,
          summary: `${displayName(person)} asked about becoming a member.`,
        }),
        ...(stageId
          ? [
              activity(ctx, {
                type: "visitor.stage_changed",
                category: "visitor",
                personId,
                summary: `${displayName(person)} moved to "${stage?.name ?? stageId}".`,
                meta: { stageId },
              }),
            ]
          : []),
      ]),
      events,
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
  if (hasCompletedOrientation(snapshot, personId)) {
    return err(`Orientation is already recorded for ${displayName(person)}.`, "unchanged");
  }

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
