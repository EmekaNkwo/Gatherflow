import { visitSummary } from "@/services/attendance/visits";
import { formatDisplayDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { foldForSearch, matchesPersonQuery } from "@/lib/person-search";
import { displayName } from "@/lib/strings";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { DemoRole } from "@/types/team";

export type SearchResultKind = "visitor" | "member" | "task" | "group" | "session";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchOptions {
  role: DemoRole;
  /** Team member id of the signed-in person, for own-task scoping. */
  teamMemberId?: string;
  limit?: number;
}

/**
 * Global search.
 *
 * Results respect the signed-in role: a volunteer only finds their own
 * tasks, a member finds nothing in the directory, and pastoral-care records
 * are never searchable from here at all — they live behind the care section
 * so a restricted note can never surface in a global result list.
 */
export function globalSearch(
  snapshot: ChurchSnapshot,
  query: string,
  options: SearchOptions,
): SearchResult[] {
  const needle = foldForSearch(query);
  if (needle.length < 2) return [];
  // Tasks, groups and sessions use the same folding as people, so "eglise"
  // finds "Église" everywhere and every word typed must appear.
  const matches = (text: string) => {
    const haystack = foldForSearch(text);
    return needle.split(" ").every((word) => haystack.includes(word));
  };

  const limit = options.limit ?? 20;
  const results: SearchResult[] = [];
  const canReadPeople = can(options.role, "people.read");

  if (canReadPeople) {
    for (const person of snapshot.people) {
      if (!matchesPersonQuery(person, query)) continue;

      results.push(
        person.member
          ? {
              kind: "member",
              id: person.id,
              title: displayName(person),
              subtitle: `Member ${person.member.reference} · ${person.member.status.replace("_", " ")}`,
              href: `/members/${person.id}`,
            }
          : {
              kind: "visitor",
              id: person.id,
              title: displayName(person),
              subtitle: `Visitor · first visit ${formatDisplayDate(visitSummary(snapshot, person.id).firstVisitDate)}`,
              href: `/visitors/${person.id}`,
            },
      );
    }
  }

  const taskScopeAll = can(options.role, "tasks.read.all");
  const taskScopeOwn = can(options.role, "tasks.read.own");
  if (taskScopeAll || taskScopeOwn) {
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
    for (const task of snapshot.tasks) {
      if (!taskScopeAll && task.assigneeId !== options.teamMemberId) continue;
      const person = peopleById.get(task.personId);
      const text = [task.reference, task.notes ?? "", person ? displayName(person) : ""].join(" ");
      if (!matches(text)) continue;

      results.push({
        kind: "task",
        id: task.id,
        title: `${task.reference} · ${task.type.replace(/_/g, " ")}`,
        subtitle: `${person ? displayName(person) : "Unknown person"} · due ${formatDisplayDate(task.dueDate)}`,
        href: `/follow-ups/tasks?task=${task.id}`,
      });
    }
  }

  for (const group of snapshot.groups) {
    if (!matches(`${group.name} ${group.description}`)) continue;
    results.push({
      kind: "group",
      id: group.id,
      title: group.name,
      subtitle: `${group.members.length} members${group.active ? "" : " · inactive"}`,
      href: `/groups/${group.id}`,
    });
  }

  for (const session of snapshot.sessions) {
    if (!matches(`${session.name} ${session.date}`)) continue;
    results.push({
      kind: "session",
      id: session.id,
      title: session.name,
      subtitle: formatDisplayDate(session.date),
      href: `/attendance/${session.id}`,
    });
  }

  const order: Record<SearchResultKind, number> = {
    visitor: 0,
    member: 1,
    task: 2,
    group: 3,
    session: 4,
  };

  return results.sort((left, right) => order[left.kind] - order[right.kind]).slice(0, limit);
}
