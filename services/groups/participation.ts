import type { GroupId } from "@/types/common";
import type { MembershipStatus, Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * One definition of "in a group" and "a current member", shared by the
 * Members filter, the Groups page and the participation figure in Reports,
 * so the three can never disagree again.
 *
 * - Only an **active** group counts. A group that is not meeting at the
 *   moment does not keep anybody connected.
 * - Only **current** members are counted: active, new and inactive. People
 *   who have transferred away or been archived have left, so they are neither
 *   "in a group" nor "not in a group" — they simply aren't in the count.
 */
export const CURRENT_MEMBER_STATUSES: readonly MembershipStatus[] = ["active", "new_member", "inactive"];

/** A member who still belongs here (not transferred, not archived). */
export function isCurrentMember(person: Pick<Person, "member">): boolean {
  return Boolean(person.member && CURRENT_MEMBER_STATUSES.includes(person.member.status));
}

/** Ids of the groups that are meeting at the moment. */
export function activeGroupIds(snapshot: Pick<ChurchSnapshot, "groups">): ReadonlySet<GroupId> {
  return new Set(snapshot.groups.filter((group) => group.active).map((group) => group.id));
}

/** True when the person belongs to at least one active group. */
export function isInActiveGroup(
  person: Pick<Person, "groupIds">,
  activeIds: ReadonlySet<GroupId>,
): boolean {
  return person.groupIds.some((id) => activeIds.has(id));
}

/** A current member who is not in any active group: the people most at risk of drifting. */
export function isUnconnectedMember(
  person: Pick<Person, "member" | "groupIds">,
  activeIds: ReadonlySet<GroupId>,
): boolean {
  return isCurrentMember(person) && !isInActiveGroup(person, activeIds);
}
