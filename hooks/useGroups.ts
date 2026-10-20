"use client";

import { useCallback, useMemo } from "react";
import type { GroupId, PersonId } from "@/types/common";
import { peopleWithoutGroup, type CreateGroupInput } from "@/services/groups/groups";
import { useCommand, useSnapshot } from "./use-church-data";

/** Groups and ministries, including who is not yet in one. */
export function useGroups() {
  const snapshot = useSnapshot();
  const { dispatch } = useCommand();

  const groups = useMemo(() => {
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
    return [...snapshot.groups]
      .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
      .map((group) => ({
        group,
        leader: group.leaderId ? peopleById.get(group.leaderId) : undefined,
        members: group.members
          .map((membership) => ({ membership, person: peopleById.get(membership.personId) }))
          .filter((entry) => entry.person),
        minorsFlag: group.involvesMinors,
      }));
  }, [snapshot]);

  const unconnected = useMemo(() => peopleWithoutGroup(snapshot), [snapshot]);

  const create = useCallback(
    (input: CreateGroupInput) => dispatch("group.create", input),
    [dispatch],
  );

  const addMember = useCallback(
    (groupId: GroupId, personId: PersonId, role: "member" | "leader" | "assistant" = "member") =>
      dispatch(
        "group.addMember",
        { groupId, personId, role },
        { undoLabel: "group assignment" },
      ),
    [dispatch],
  );

  const removeMember = useCallback(
    (groupId: GroupId, personId: PersonId) =>
      dispatch(
        "group.removeMember",
        { groupId, personId },
        { undoLabel: "removing the group member" },
      ),
    [dispatch],
  );

  const assignLeader = useCallback(
    (groupId: GroupId, personId: PersonId) =>
      dispatch("group.setLeader", { groupId, personId }),
    [dispatch],
  );

  const setActive = useCallback(
    (groupId: GroupId, active: boolean) => dispatch("group.setActive", { groupId, active }),
    [dispatch],
  );

  return { groups, unconnected, create, addMember, removeMember, assignLeader, setActive };
}

export function useGroup(groupId: GroupId) {
  const { groups } = useGroups();
  return useMemo(() => groups.find((entry) => entry.group.id === groupId), [groups, groupId]);
}

/** Group meetings coming up this week, for the follow-up calendar. */
export function useGroupSchedule() {
  const snapshot = useSnapshot();
  return useMemo(
    () =>
      snapshot.groups
        .filter((group) => group.active && group.schedule)
        .map((group) => ({ group, schedule: group.schedule! })),
    [snapshot.groups],
  );
}
