import { describe, expect, it } from "vitest";
import { group, member, NOW, snapshot, visitor } from "@/tests/factories";
import type { MembershipStatus } from "@/types/person";
import { groupParticipation, selectMembers } from "../members/selectors";
import { peopleWithoutGroup } from "./groups";
import { isCurrentMember, isUnconnectedMember, activeGroupIds } from "./participation";

/**
 * H4: the Members "Not in a group" filter, the Groups page list and the
 * Reports participation figure must all count the same people.
 */
function church() {
  const base = member().member!;
  const as = (id: string, status: MembershipStatus, groupIds: string[] = []) =>
    member({ id, groupIds, member: { ...base, reference: `MEM-${id}`, status } });
  return snapshot({
    groups: [group({ id: "g_live" }), group({ id: "g_paused", name: "Paused", active: false })],
    people: [
      as("in_live", "active", ["g_live"]),
      as("only_paused", "active", ["g_paused"]),
      as("none_new", "new_member"),
      as("none_inactive", "inactive"),
      as("transferred", "transferred"),
      as("archived", "archived", ["g_live"]),
      visitor({ id: "v_none" }),
    ],
  });
}

describe("one 'not in a group' definition", () => {
  it("members filter, groups page and reports agree", () => {
    const data = church();
    const fromFilter = selectMembers(data, { filter: "no_group" }, NOW).map((row) => row.person.id).sort();
    const fromGroups = peopleWithoutGroup(data).map((person) => person.id).sort();
    const participation = groupParticipation(data);

    expect(fromFilter).toEqual(["none_inactive", "none_new", "only_paused"]);
    expect(fromGroups).toEqual(fromFilter);
    expect(participation.denominator - participation.numerator).toBe(fromFilter.length);
    expect(participation.denominator).toBe(selectMembers(data, { filter: "all" }, NOW).length);
  });

  it("treats only active groups as connecting and only current members as counted", () => {
    const data = church();
    const ids = activeGroupIds(data);
    const byId = new Map(data.people.map((person) => [person.id, person]));
    expect(isUnconnectedMember(byId.get("only_paused")!, ids)).toBe(true);
    expect(isUnconnectedMember(byId.get("in_live")!, ids)).toBe(false);
    expect(isUnconnectedMember(byId.get("transferred")!, ids)).toBe(false);
    expect(isCurrentMember(byId.get("v_none")!)).toBe(false);
  });
});
