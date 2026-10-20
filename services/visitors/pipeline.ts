import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { ContactMethod, PersonId, TeamMemberId } from "@/types/common";
import type { PipelineStage } from "@/types/follow-up";
import { CLOSURE_REASON_LABELS, type ClosureReason, type Person } from "@/types/person";
import type { ChurchSettings } from "@/types/settings";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { activity, findPerson, patch, withActivity, withPerson } from "../core/snapshot";
import { plainStageName } from "./stage-names";

/** Stages, in configured order. */
export function orderedStages(settings: ChurchSettings): readonly PipelineStage[] {
  return [...settings.pipelineStages].sort((left, right) => left.order - right.order);
}

export function findStage(
  settings: ChurchSettings,
  stageId: string,
): PipelineStage | undefined {
  return settings.pipelineStages.find((stage) => stage.id === stageId);
}

export function stageOrder(settings: ChurchSettings, stageId: string): number {
  return findStage(settings, stageId)?.order ?? 0;
}

export function isTerminalStage(settings: ChurchSettings, stageId: string): boolean {
  return findStage(settings, stageId)?.kind === "terminal";
}

/**
 * A visitor nobody has been asked to welcome yet. Somebody already settled
 * in, or whose follow-up has stopped, does not need anyone assigned. The one
 * definition behind the dashboard figure, the list it links to, and the
 * "needs a decision" item, so the three can never disagree.
 */
export function isAwaitingAssignment(settings: ChurchSettings, person: Person): boolean {
  const visitor = person.visitor;
  return (
    visitor !== undefined &&
    !person.member &&
    !visitor.assignedTo &&
    !visitor.closure &&
    !isTerminalStage(settings, visitor.stageId)
  );
}

/**
 * The stage a closed record lands in. Churches can rename or remove stages,
 * so this prefers the conventional `closed` stage and otherwise falls back
 * to the last terminal stage in the configured order.
 */
export function closureStage(settings: ChurchSettings): PipelineStage | undefined {
  const terminal = orderedStages(settings).filter((stage) => stage.kind === "terminal");
  return terminal.find((stage) => stage.id === "closed") ?? terminal.at(-1);
}

/**
 * Moves a visitor forward to `stageId`, but never backwards and never out of
 * a terminal stage — progress is recorded, not rewritten.
 */
export function advanceStage(
  settings: ChurchSettings,
  person: Person,
  stageId: string,
): string | null {
  if (!person.visitor) return null;
  const current = person.visitor.stageId;
  if (current === stageId) return null;
  if (isTerminalStage(settings, current)) return null;
  if (!findStage(settings, stageId)) return null;
  if (stageOrder(settings, stageId) <= stageOrder(settings, current)) return null;
  return stageId;
}

export function setStage(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  stageId: string,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");
  if (!person.visitor) return err("Only visitor records move through the pipeline.", "not_visitor");

  const stage = findStage(snapshot.settings, stageId);
  if (!stage) return err("That pipeline stage no longer exists.", "not_found");
  if (person.visitor.stageId === stageId) return err("Already in that stage.", "unchanged");
  // Stopping follow-up records a reason and cancels open tasks, so it has
  // its own command; a plain move would leave tasks running for somebody
  // marked as stopped.
  if (stageId === closureStage(snapshot.settings)?.id) {
    return err(
      `Use "Stop following up" for ${displayName(person)}, so the reason is recorded and open follow-ups are cancelled.`,
      "invalid",
    );
  }
  if (person.visitor.closure) {
    return err(
      `Follow-up for ${displayName(person)} has stopped. Reopen it first.`,
      "closed",
    );
  }

  const next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      visitor: entry.visitor
        ? { ...entry.visitor, stageId, stageUpdatedAt: ctx.nowIso }
        : entry.visitor,
    }),
    ctx,
  );

  const events: DomainEvent[] = [{ type: "visitor.stage_changed", personId, stageId }];

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.stage_changed",
          category: "visitor",
          personId,
          summary: `${displayName(person)} moved to "${plainStageName(stage)}".`,
          meta: { stageId },
        }),
      ]),
      events,
      // The same words as the board column it lands in.
      [`${displayName(person)} moved to ${plainStageName(stage)}.`],
    ),
  );
}

export function assignVisitor(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  assigneeId: TeamMemberId | undefined,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, personId);
  if (!person?.visitor) return err("That visitor record no longer exists.", "not_found");

  const member = assigneeId ? snapshot.team.find((entry) => entry.id === assigneeId) : undefined;
  if (assigneeId && !member) return err("That team member no longer exists.", "not_found");
  if (member && !member.active) {
    return err(`${member.name} is marked as inactive and cannot take new follow-ups.`, "inactive");
  }
  if (person.visitor.assignedTo === assigneeId) {
    return err(
      member
        ? `${displayName(person)} is already looked after by ${member.name}.`
        : `${displayName(person)} isn't assigned to anyone.`,
      "unchanged",
    );
  }
  // Unassigning is always allowed; giving somebody new work for a person
  // who asked not to be contacted, or whose follow-up has stopped, is not.
  if (assigneeId && person.contact.optedOut) {
    return err(`${displayName(person)} has asked not to be contacted.`, "opted_out");
  }
  if (assigneeId && person.visitor.closure) {
    return err(
      `Follow-up for ${displayName(person)} has stopped. Reopen it before assigning someone.`,
      "closed",
    );
  }

  let next = withPerson(
    snapshot,
    personId,
    (entry) => ({
      ...entry,
      visitor: entry.visitor ? { ...entry.visitor, assignedTo: assigneeId } : entry.visitor,
    }),
    ctx,
  );

  // Open tasks follow the assignment so work never sits with the wrong person.
  next = patch(next, {
    tasks: next.tasks.map((task) =>
      task.personId === personId &&
      ["pending", "in_progress", "rescheduled"].includes(task.status) &&
      task.type !== "pastoral_contact"
        ? { ...task, assigneeId }
        : task,
    ),
  });

  // Assigning someone moves a brand-new visitor into "contact pending".
  const promoted = advanceStage(next.settings, person, "contact_pending");
  if (assigneeId && promoted) {
    next = withPerson(
      next,
      personId,
      (entry) => ({
        ...entry,
        visitor: entry.visitor
          ? { ...entry.visitor, stageId: promoted, stageUpdatedAt: ctx.nowIso }
          : entry.visitor,
      }),
      ctx,
    );
  }

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.assigned",
          category: "visitor",
          personId,
          summary: member
            ? `${displayName(person)} assigned to ${member.name} for follow-up.`
            : `${displayName(person)} is no longer assigned to anyone.`,
        }),
      ]),
      [],
      [
        member
          ? `${displayName(person)} assigned to ${member.name}.`
          : `${displayName(person)} unassigned.`,
      ],
    ),
  );
}

export interface CloseFollowUpInput {
  personId: PersonId;
  reason: ClosureReason;
  note?: string;
  /** Also record a contact opt-out, for "contact declined". */
  optOut?: boolean;
}

/**
 * Stops follow-up for a visitor and cancels any open tasks, so nobody is
 * contacted after asking us not to.
 */
export function closeFollowUp(
  snapshot: ChurchSnapshot,
  input: CloseFollowUpInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, input.personId);
  if (!person?.visitor) return err("That visitor record no longer exists.", "not_found");

  const closedStage = closureStage(snapshot.settings);

  let next = withPerson(
    snapshot,
    input.personId,
    (entry) => ({
      ...entry,
      contact: input.optOut
        ? {
            ...entry.contact,
            optedOut: true,
            permissionGranted: false,
            optedOutAt: ctx.nowIso,
            optOutReason: input.note,
          }
        : entry.contact,
      visitor: entry.visitor
        ? {
            ...entry.visitor,
            stageId: closedStage?.id ?? entry.visitor.stageId,
            stageUpdatedAt: ctx.nowIso,
            closure: { reason: input.reason, note: input.note, recordedAt: ctx.nowIso },
          }
        : entry.visitor,
    }),
    ctx,
  );

  const cancelled = next.tasks.filter(
    (task) =>
      task.personId === input.personId &&
      ["pending", "in_progress", "rescheduled"].includes(task.status),
  );

  next = patch(next, {
    tasks: next.tasks.map((task) =>
      cancelled.some((entry) => entry.id === task.id)
        ? {
            ...task,
            status: "cancelled",
            notes: `${task.notes ? `${task.notes}\n` : ""}Cancelled: ${CLOSURE_REASON_LABELS[input.reason]}.`,
          }
        : task,
    ),
  });

  const events: DomainEvent[] = [
    { type: "visitor.follow_up_stopped", personId: input.personId },
  ];

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.closed",
          category: "visitor",
          personId: input.personId,
          summary: `Follow-up for ${displayName(person)} stopped — ${CLOSURE_REASON_LABELS[
            input.reason
          ].toLowerCase()}.`,
        }),
        ...(input.optOut
          ? [
              activity(ctx, {
                type: "visitor.contact_preference_changed" as const,
                category: "visitor" as const,
                personId: input.personId,
                summary: `${displayName(person)} opted out of contact. No further messages or tasks will be created.`,
              }),
            ]
          : []),
      ]),
      events,
      [
        `Follow-up stopped for ${displayName(person)}.`,
        ...(cancelled.length
          ? [`${cancelled.length} open task${cancelled.length === 1 ? "" : "s"} cancelled.`]
          : []),
      ],
    ),
  );
}

export interface ReopenFollowUpInput {
  personId: PersonId;
  /** An active stage to resume in; otherwise one is chosen from their history. */
  stageId?: string;
}

/** Where a reopened visitor resumes: as far as they had actually got. */
function resumeStage(settings: ChurchSettings, person: Person): PipelineStage | undefined {
  const active = orderedStages(settings).filter((stage) => stage.kind === "active");
  const preferred = person.visitor?.lastContactAt
    ? "contacted"
    : person.visitor?.assignedTo
      ? "contact_pending"
      : undefined;
  return active.find((stage) => stage.id === preferred) ?? active[0];
}

/**
 * Undoes a stop, or a move into a final stage made by mistake: clears the
 * closure and puts the visitor back in an active stage. Open tasks cancelled
 * at closure stay cancelled; whoever reopens decides the next step.
 */
export function reopenFollowUp(
  snapshot: ChurchSnapshot,
  input: ReopenFollowUpInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, input.personId);
  if (!person?.visitor) return err("That visitor record no longer exists.", "not_found");
  if (person.member) return err(`${displayName(person)} is now a member.`, "invalid");

  const visitor = person.visitor;
  if (!visitor.closure && !isTerminalStage(snapshot.settings, visitor.stageId)) {
    return err(`Follow-up for ${displayName(person)} is already open.`, "unchanged");
  }
  if (person.contact.optedOut) {
    return err(
      `${displayName(person)} asked not to be contacted. Change their contact preferences first.`,
      "opted_out",
    );
  }

  const requested = input.stageId ? findStage(snapshot.settings, input.stageId) : undefined;
  if (input.stageId && (!requested || requested.kind !== "active")) {
    return err("Choose a stage that is still in progress.", "invalid");
  }
  const stage = requested ?? resumeStage(snapshot.settings, person);
  if (!stage) return err("There is no active stage to reopen into.", "invalid");

  const next = withPerson(
    snapshot,
    input.personId,
    (entry) => ({
      ...entry,
      visitor: entry.visitor
        ? { ...entry.visitor, stageId: stage.id, stageUpdatedAt: ctx.nowIso, closure: undefined }
        : entry.visitor,
    }),
    ctx,
  );

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.reopened",
          category: "visitor",
          personId: input.personId,
          summary: `Follow-up for ${displayName(person)} reopened in "${plainStageName(stage)}".`,
          meta: { stageId: stage.id },
        }),
      ]),
      [{ type: "visitor.stage_changed", personId: input.personId, stageId: stage.id }],
      [`Follow-up for ${displayName(person)} reopened. Decide the next step.`],
    ),
  );
}

export interface ContactPreferenceInput {
  personId: PersonId;
  preferredMethod?: ContactMethod;
  permissionGranted?: boolean;
  optedOut?: boolean;
  optOutReason?: string;
}

/** Records a contact preference change, including opt-in and opt-out. */
export function setContactPreferences(
  snapshot: ChurchSnapshot,
  input: ContactPreferenceInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  const optedOut = input.optedOut ?? person.contact.optedOut;
  const nowOptingOut = optedOut && !person.contact.optedOut;

  let next = withPerson(
    snapshot,
    input.personId,
    (entry) => ({
      ...entry,
      contact: {
        ...entry.contact,
        preferredMethod: input.preferredMethod ?? entry.contact.preferredMethod,
        permissionGranted: optedOut ? false : (input.permissionGranted ?? entry.contact.permissionGranted),
        optedOut,
        optedOutAt: optedOut ? (entry.contact.optedOutAt ?? ctx.nowIso) : undefined,
        optOutReason: optedOut ? (input.optOutReason ?? entry.contact.optOutReason) : undefined,
      },
    }),
    ctx,
  );

  const notices: string[] = ["Contact preferences updated."];
  const events: DomainEvent[] = [];

  if (nowOptingOut) {
    const open = next.tasks.filter(
      (task) =>
        task.personId === input.personId &&
        task.type !== "pastoral_contact" &&
        ["pending", "in_progress", "rescheduled"].includes(task.status),
    );
    next = patch(next, {
      tasks: next.tasks.map((task) =>
        open.some((entry) => entry.id === task.id)
          ? {
              ...task,
              status: "cancelled",
              notes: `${task.notes ? `${task.notes}\n` : ""}Cancelled: the person opted out of contact.`,
            }
          : task,
      ),
    });
    events.push({ type: "visitor.follow_up_stopped", personId: input.personId });
    if (open.length) {
      notices.push(`${open.length} open follow-up task${open.length === 1 ? "" : "s"} cancelled.`);
    }
  }

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "visitor.contact_preference_changed",
          category: "visitor",
          personId: input.personId,
          summary: nowOptingOut
            ? `${displayName(person)} opted out of contact.`
            : `Contact preferences updated for ${displayName(person)}.`,
        }),
      ]),
      events,
      notices,
    ),
  );
}
