"use client";

import { useCallback, useMemo } from "react";
import type { GroupId, PersonId } from "@/types/common";
import {
  addGroupMember,
  createGroup,
  peopleWithoutGroup,
  removeGroupMember,
  setGroupActive,
  setGroupLeader,
  type CreateGroupInput,
} from "@/services/groups/groups";
import { useCommand, useSnapshot } from "./use-church-data";

/** Groups and ministries, including who is not yet in one. */
export function useGroups() {
  const snapshot = useSnapshot();
  const { run } = useCommand();

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
    (input: CreateGroupInput) => run((snap, ctx) => createGroup(snap, input, ctx)),
    [run],
  );

  const addMember = useCallback(
    (groupId: GroupId, personId: PersonId, role: "member" | "leader" | "assistant" = "member") =>
      run((snap, ctx) => addGroupMember(snap, groupId, personId, role, ctx), {
        undoLabel: "group assignment",
      }),
    [run],
  );

  const removeMember = useCallback(
    (groupId: GroupId, personId: PersonId) =>
      run((snap, ctx) => removeGroupMember(snap, groupId, personId, ctx), {
        undoLabel: "removing the group member",
      }),
    [run],
  );

  const assignLeader = useCallback(
    (groupId: GroupId, personId: PersonId) =>
      run((snap, ctx) => setGroupLeader(snap, groupId, personId, ctx)),
    [run],
  );

  const setActive = useCallback(
    (groupId: GroupId, active: boolean) =>
      run((snap) => setGroupActive(snap, groupId, active)),
    [run],
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
