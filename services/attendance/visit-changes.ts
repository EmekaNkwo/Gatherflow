import { displayName } from "@/lib/strings";
import type { IsoDate, PersonId, SessionId } from "@/types/common";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import type { DomainEvent } from "../core/events";
import { activity, findPerson, patch, replaceById, withActivity } from "../core/snapshot";
import { isOpen } from "../follow-ups/tasks";
import { findStage, orderedStages } from "../visitors/pipeline";
import { visitCount, withFirstVisitFlags } from "./visits";

/**
 * What a change to somebody's attendance means for the rest of their record.
 *
 * Checking in, undoing, restoring and moving all end here, so the stored
 * first-visit flag, the "came back" event, and the follow-up it started stay
 * in step with the attendance itself — including when a visit is taken away
 * again.
 */

/** The stage the automation moves a returning visitor into. */
const RETURNED_STAGE = "returned";
/** Prefix of the follow-up the return-visit rule creates. */
const RETURN_TASK_PREFIX = "return_visit_review";

export interface VisitChange {
  snapshot: ChurchSnapshot;
  events: DomainEvent[];
  notices: string[];
}

/**
 * Compares a person's visits before and after a change and settles the
 * consequences.
 *
 * - More visits (and the service has happened): a `visitor.returned` event.
 * - Fewer visits: the return-visit follow-up for each lost visit is
 *   cancelled, and a visitor left with a single visit moves back out of
 *   "Returned" to the stage they were in before.
 */
export function settleVisitChange(
  before: ChurchSnapshot,
  after: ChurchSnapshot,
  personId: PersonId,
  session: { id: SessionId; date: IsoDate },
  ctx: CommandContext,
): VisitChange {
  const flagged = withFirstVisitFlags(after, personId);
  const person = findPerson(flagged, personId);
  if (!person?.visitor) return { snapshot: flagged, events: [], notices: [] };

  const previous = visitCount(before, personId, { until: ctx.today });
  const now = visitCount(flagged, personId, { until: ctx.today });

  if (now > previous && now > 1 && session.date <= ctx.today) {
    return {
      snapshot: flagged,
      events: [{ type: "visitor.returned", personId, sessionId: session.id, visitCount: now }],
      notices: [],
    };
  }

  if (now >= previous) return { snapshot: flagged, events: [], notices: [] };

  const cancelled = cancelReturnFollowUps(flagged, person, now, ctx);
  if (now >= 2) return { ...cancelled, events: [] };

  const moved = moveBackFromReturned(cancelled.snapshot, person, ctx);
  return {
    snapshot: moved.snapshot,
    events: [],
    notices: [...cancelled.notices, ...moved.notices],
  };
}

/** The visit number a return-visit follow-up was created for, if it is one. */
function returnVisitNumber(automationKey: string | undefined, personId: PersonId): number | null {
  const prefix = `${RETURN_TASK_PREFIX}:${personId}:`;
  if (!automationKey?.startsWith(prefix)) return null;
  const visit = Number(automationKey.slice(prefix.length));
  return Number.isInteger(visit) ? visit : null;
}

/**
 * Cancels open return-visit follow-ups for visits that no longer exist. The
 * automation key is retired with the task, so if the visit is recorded again
 * the rule can create a fresh follow-up for it.
 */
function cancelReturnFollowUps(
  snapshot: ChurchSnapshot,
  person: Person,
  visits: number,
  ctx: CommandContext,
): { snapshot: ChurchSnapshot; notices: string[] } {
  const stale = snapshot.tasks.filter((task) => {
    if (task.personId !== person.id || !isOpen(task)) return false;
    const visit = returnVisitNumber(task.automationKey, person.id);
    return visit !== null && visit > visits;
  });
  if (!stale.length) return { snapshot, notices: [] };

  const staleIds = new Set(stale.map((task) => task.id));
  const next = patch(snapshot, {
    tasks: snapshot.tasks.map((task) =>
      staleIds.has(task.id)
        ? {
            ...task,
            status: "cancelled" as const,
            automationKey: `${task.automationKey}:undone:${task.id}`,
            notes: `${task.notes ? `${task.notes}\n` : ""}Cancelled: the return visit was taken off the attendance list.`,
          }
        : task,
    ),
  });

  return {
    snapshot: withActivity(
      next,
      ctx,
      stale.map((task) =>
        activity(ctx, {
          type: "follow_up.cancelled",
          category: "follow_up",
          personId: person.id,
          summary: `${task.reference} was cancelled — the return visit it was for was taken off the attendance list.`,
          meta: { taskId: task.id },
        }),
      ),
    ),
    notices: [`The check-in follow-up for ${displayName(person)}'s return visit was cancelled.`],
  };
}

/**
 * The stage a visitor was in before they were moved to "Returned": the stage
 * history kept on the timeline first, and failing that the furthest stage
 * their record shows they had reached.
 */
function stageBeforeReturned(snapshot: ChurchSnapshot, person: Person): string | undefined {
  const history = snapshot.activity.filter(
    (entry) =>
      entry.personId === person.id && entry.type === "visitor.stage_changed" && entry.meta?.stageId,
  );
  const intoReturned = history.findIndex((entry) => entry.meta?.stageId === RETURNED_STAGE);
  const earlier = intoReturned >= 0 ? history[intoReturned + 1]?.meta?.stageId : undefined;
  if (earlier && earlier !== RETURNED_STAGE && findStage(snapshot.settings, earlier)) return earlier;

  const visitor = person.visitor;
  const candidates = [
    visitor?.lastContactAt ? "contacted" : undefined,
    visitor && visitor.contactAttempts > 0 ? "contact_attempted" : undefined,
    visitor?.assignedTo ? "contact_pending" : undefined,
  ];
  const known = candidates.find((id) => id && findStage(snapshot.settings, id));
  return known ?? orderedStages(snapshot.settings)[0]?.id;
}

function moveBackFromReturned(
  snapshot: ChurchSnapshot,
  person: Person,
  ctx: CommandContext,
): { snapshot: ChurchSnapshot; notices: string[] } {
  const current = findPerson(snapshot, person.id);
  if (current?.visitor?.stageId !== RETURNED_STAGE) return { snapshot, notices: [] };

  const stageId = stageBeforeReturned(snapshot, current);
  const stage = stageId ? findStage(snapshot.settings, stageId) : undefined;
  if (!stage || stage.id === RETURNED_STAGE) return { snapshot, notices: [] };

  const next = patch(snapshot, {
    people: replaceById(snapshot.people, person.id, (entry) => ({
      ...entry,
      visitor: entry.visitor
        ? { ...entry.visitor, stageId: stage.id, stageUpdatedAt: ctx.nowIso }
        : entry.visitor,
      updatedAt: ctx.nowIso,
    })),
  });

  return {
    snapshot: withActivity(next, ctx, [
      activity(ctx, {
        type: "visitor.stage_changed",
        category: "visitor",
        personId: person.id,
        summary: `${displayName(person)}'s return visit was taken off the list, so they moved back to "${stage.name}".`,
        meta: { stageId: stage.id },
      }),
    ]),
    notices: [`${displayName(person)} moved back to ${stage.name}.`],
  };
}
