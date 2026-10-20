import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * What a role scoped to its own work (a volunteer) may act on.
 *
 * Reads are already scoped — a volunteer only receives their own tasks — but
 * a request can name any id. These predicates are what the server checks
 * before running such a command, and what the interface checks before
 * offering it, so the two can never disagree.
 */
export function ownsTask(snapshot: ChurchSnapshot, taskId: string, teamMemberId: string): boolean {
  return snapshot.tasks.some((task) => task.id === taskId && task.assigneeId === teamMemberId);
}

/** Somebody they look after, or have been given follow-up work for. */
export function looksAfter(snapshot: ChurchSnapshot, personId: string, teamMemberId: string): boolean {
  const person = snapshot.people.find((entry) => entry.id === personId);
  if (person?.visitor?.assignedTo === teamMemberId) return true;
  return snapshot.tasks.some((task) => task.personId === personId && task.assigneeId === teamMemberId);
}
