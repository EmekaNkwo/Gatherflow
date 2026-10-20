import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * The church as a role without pastoral-care access may see it.
 *
 * Care records are never queried for such a role (see `LoadScope`), but two
 * restricted things live inside other records: a member's emergency contact,
 * and timeline entries marked `restricted` (a care record opened, a care
 * note). Both are removed here, on the server, so they never reach a browser
 * that is not allowed them — hiding them in the interface is not enough.
 */
export function withoutRestricted(snapshot: ChurchSnapshot): ChurchSnapshot {
  return {
    ...snapshot,
    people: snapshot.people.map((person) => {
      if (!person.member?.emergencyContact) return person;
      const { emergencyContact: _restricted, ...member } = person.member;
      void _restricted;
      return { ...person, member };
    }),
    activity: snapshot.activity.filter((entry) => entry.visibility === "general"),
  };
}

/**
 * Timeline entries about a follow-up go only to people who can see that
 * follow-up. A volunteer reads their own tasks, so the history of somebody
 * else's — including a pastoral-care contact — is not theirs to read either.
 * `tasks` here are the tasks this caller was given.
 */
export function withoutUnseenTaskActivity(snapshot: ChurchSnapshot): ChurchSnapshot {
  const visible = new Set(snapshot.tasks.map((task) => task.id));
  return {
    ...snapshot,
    activity: snapshot.activity.filter((entry) => {
      const taskId = entry.meta?.taskId;
      return !taskId || visible.has(taskId);
    }),
  };
}
