import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { ContactMethod, IsoDate, SessionId, TeamMemberId } from "@/types/common";
import { VISITOR_SOURCE_LABELS, type Person, type VisitorSource } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, patch, withActivity } from "../core/snapshot";
import { recordAttendance } from "../attendance/check-in";
import { orderedStages } from "./pipeline";

export interface RegisterVisitorInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  visitDate: IsoDate;
  /** Session attended, when the visitor is registered at a service. */
  sessionId?: SessionId;
  source: VisitorSource;
  assignedTo?: TeamMemberId;
  preferredMethod: ContactMethod;
  /** The visitor agreed to be contacted. Defaults to false — consent is opt-in. */
  permissionGranted: boolean;
  interests?: readonly string[];
  notes?: string;
  /** Set by the public `/connect` page. */
  selfRegistered?: boolean;
  /** The visitor said this was not their first time. */
  returningVisitor?: boolean;
}

/**
 * Registers a first-time visitor.
 *
 * Only a name is strictly required: nobody is forced to hand over a phone
 * number to be welcomed. Attendance is recorded at the same time when the
 * session is known, so the visit count comes from real attendance rows.
 */
export function registerVisitor(
  snapshot: ChurchSnapshot,
  input: RegisterVisitorInput,
  ctx: CommandContext,
): Result<CommandResult & { personId: string }> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    return err("A first and last name are needed to create a record.", "invalid");
  }

  const stages = orderedStages(snapshot.settings);
  const firstStage = stages[0];
  if (!firstStage) return err("No pipeline stages are configured.", "invalid");

  const assigned = input.assignedTo
    ? snapshot.team.find((member) => member.id === input.assignedTo)
    : undefined;
  if (input.assignedTo && !assigned) {
    return err("That team member no longer exists.", "not_found");
  }

  const stageId =
    assigned && stages.find((stage) => stage.id === "contact_pending")
      ? "contact_pending"
      : firstStage.id;

  const person: Person = {
    id: ctx.id("person"),
    kind: "visitor",
    firstName,
    lastName,
    preferredName: input.preferredName?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    ageGroup: "adult",
    interests: input.interests ?? [],
    groupIds: [],
    contact: {
      preferredMethod: input.preferredMethod,
      permissionGranted: input.permissionGranted,
      optedOut: false,
    },
    visitor: {
      firstVisitDate: input.visitDate,
      source: input.source,
      firstSessionId: input.sessionId,
      assignedTo: input.assignedTo,
      stageId,
      stageUpdatedAt: ctx.nowIso,
      contactAttempts: 0,
      notes: input.notes?.trim() || undefined,
    },
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  let next = patch(snapshot, { people: [...snapshot.people, person] });

  const events: DomainEvent[] = [
    {
      type: "visitor.registered",
      personId: person.id,
      firstVisitDate: input.visitDate,
    },
  ];
  const notices: string[] = [`${displayName(person)} registered.`];

  if (input.sessionId) {
    const attendance = recordAttendance(
      next,
      {
        sessionId: input.sessionId,
        personId: person.id,
        method: input.selfRegistered ? "self_registration" : "new_visitor",
      },
      ctx,
    );
    if (attendance.ok) {
      next = attendance.value.snapshot;
      events.push(...attendance.value.events);
    }
  }

  next = withActivity(next, ctx, [
    activity(ctx, {
      type: input.selfRegistered ? "visitor.self_registered" : "visitor.registered",
      category: "visitor",
      personId: person.id,
      summary: `${displayName(person)} registered as a ${
        input.returningVisitor ? "returning" : "first-time"
      } visitor (${VISITOR_SOURCE_LABELS[input.source]})${
        input.selfRegistered ? " using the welcome page" : ""
      }.`,
    }),
    ...(assigned
      ? [
          activity(ctx, {
            type: "visitor.assigned" as const,
            category: "visitor" as const,
            personId: person.id,
            summary: `${displayName(person)} assigned to ${assigned.name} for follow-up.`,
          }),
        ]
      : []),
  ]);

  if (!input.permissionGranted) {
    notices.push("No contact permission was given, so no messages will be drafted.");
  }

  return ok({ ...result(next, events, notices), personId: person.id });
}

/**
 * Records an additional visit for someone already in the directory — used
 * when a duplicate suggestion turns out to be the same person.
 */
export function recordReturnVisit(
  snapshot: ChurchSnapshot,
  personId: string,
  sessionId: SessionId,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = snapshot.people.find((entry) => entry.id === personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  return recordAttendance(snapshot, { sessionId, personId, method: "search" }, ctx);
}
