import type { ActivityEvent } from "@/types/activity";
import type { PersonId } from "@/types/common";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "./context";

/**
 * Immutable snapshot helpers. Nothing in the services mutates a record in
 * place: every change produces a new object, which keeps undo, persistence
 * diffing and React re-rendering straightforward.
 */

export function patch(
  snapshot: ChurchSnapshot,
  changes: Partial<ChurchSnapshot>,
): ChurchSnapshot {
  return { ...snapshot, ...changes };
}

export function replaceById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  update: (item: T) => T,
): readonly T[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return update(item);
  });
  return changed ? next : items;
}

export function upsertById<T extends { id: string }>(
  items: readonly T[],
  item: T,
): readonly T[] {
  const exists = items.some((entry) => entry.id === item.id);
  return exists ? items.map((entry) => (entry.id === item.id ? item : entry)) : [...items, item];
}

export function findPerson(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): Person | undefined {
  return snapshot.people.find((person) => person.id === personId);
}

export function withPerson(
  snapshot: ChurchSnapshot,
  personId: PersonId,
  update: (person: Person) => Person,
  ctx: CommandContext,
): ChurchSnapshot {
  return patch(snapshot, {
    people: replaceById(snapshot.people, personId, (person) => ({
      ...update(person),
      updatedAt: ctx.nowIso,
    })),
  });
}

/** Appends timeline entries, newest first. */
export function withActivity(
  snapshot: ChurchSnapshot,
  ctx: CommandContext,
  entries: ReadonlyArray<Omit<ActivityEvent, "id">>,
): ChurchSnapshot {
  if (!entries.length) return snapshot;
  const events: ActivityEvent[] = entries.map((entry) => ({
    ...entry,
    id: ctx.id("activity"),
  }));
  return patch(snapshot, { activity: [...events, ...snapshot.activity] });
}

/** Convenience builder for a general-visibility activity entry. */
export function activity(
  ctx: CommandContext,
  entry: Omit<ActivityEvent, "id" | "at" | "actorId" | "visibility"> &
    Partial<Pick<ActivityEvent, "at" | "actorId" | "visibility">>,
): Omit<ActivityEvent, "id"> {
  return {
    visibility: "general",
    actorId: ctx.actorId,
    at: ctx.nowIso,
    ...entry,
  };
}
