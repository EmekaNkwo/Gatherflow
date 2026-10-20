import { formatDisplayDate } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { ContactMethod, IsoDate, SessionId, TeamMemberId } from "@/types/common";
import { VISITOR_SOURCE_LABELS, type Person, type VisitorSource } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, patch, withActivity } from "../core/snapshot";
import { recordAttendance } from "../attendance/check-in";
import { visitCount } from "../attendance/visits";
import { orderedStages } from "./pipeline";

export interface RegisterVisitorInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  /**
   * The day of the visit. Ignored when `sessionId` is given: the visit is
   * then on the day of that service, whatever the form sent.
   */
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
 * session is known, and the first visit is then the service's own date, so
 * the profile, the visitor list and the monthly figures never disagree with
 * the attendance. A visit in the future is refused.
 *
 * A visitor who says they have been before is kept as such: they are never
 * counted as first-time, and they move to "Returned" like anyone else
 * coming back.
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

  const session = input.sessionId
    ? snapshot.sessions.find((entry) => entry.id === input.sessionId)
    : undefined;
  if (input.sessionId && !session) return err("That session no longer exists.", "not_found");

  const visitDate = session?.date ?? input.visitDate;
  if (visitDate > ctx.today) {
    return err(
      `${formatDisplayDate(visitDate)} hasn't happened yet. Register visitors on or after the day they came.`,
      "invalid",
    );
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
      firstVisitDate: visitDate,
      source: input.source,
      firstSessionId: input.sessionId,
      assignedTo: input.assignedTo,
      stageId,
      stageUpdatedAt: ctx.nowIso,
      contactAttempts: 0,
      notes: input.notes?.trim() || undefined,
      ...(input.returningVisitor ? { returningVisitor: true } : {}),
    },
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  let next = patch(snapshot, { people: [...snapshot.people, person] });

  const events: DomainEvent[] = [
    {
      type: "visitor.registered",
      personId: person.id,
      firstVisitDate: visitDate,
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
    if (!attendance.ok) return attendance;
    next = attendance.value.snapshot;
    events.push(...attendance.value.events);
  }

  // "They've been before": this visit is at least their second.
  if (input.returningVisitor && !events.some((event) => event.type === "visitor.returned")) {
    events.push({
      type: "visitor.returned",
      personId: person.id,
      sessionId: input.sessionId,
      visitCount: visitCount(next, person.id, { until: ctx.today }),
    });
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
