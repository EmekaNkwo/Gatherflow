import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { GroupId, PersonId } from "@/types/common";
import type { Person } from "@/types/person";
import type { Group, GroupSchedule, GroupType } from "@/types/group";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import {
  activity,
  findPerson,
  patch,
  replaceById,
  withActivity,
  withPerson,
} from "../core/snapshot";
import { advanceStage } from "../visitors/pipeline";
import { activeGroupIds, isUnconnectedMember } from "./participation";

/** Membership statuses that mean someone has left, so can't join a group. */
const DEPARTED_STATUSES = ["transferred", "archived"] as const;

/**
 * True when a person can be added to a group: anyone still part of the
 * church. Transferred and archived members have left.
 */
export function canJoinGroups(person: Pick<Person, "member">): boolean {
  return !person.member || !(DEPARTED_STATUSES as readonly string[]).includes(person.member.status);
}

export interface CreateGroupInput {
  name: string;
  description: string;
  type: GroupType;
  leaderId?: PersonId;
  schedule?: GroupSchedule;
  location?: string;
  involvesMinors?: boolean;
}

export function createGroup(
  snapshot: ChurchSnapshot,
  input: CreateGroupInput,
  ctx: CommandContext,
): Result<CommandResult & { groupId: GroupId }> {
  const name = input.name.trim();
  if (!name) return err("Give the group a name.", "invalid");
  if (snapshot.groups.some((group) => group.name.trim().toLowerCase() === name.toLowerCase())) {
    return err("A group with that name already exists.", "duplicate");
  }

  const group: Group = {
    id: ctx.id("group"),
    name,
    description: input.description.trim(),
    type: input.type,
    leaderId: input.leaderId,
    members: input.leaderId
      ? [
          {
            personId: input.leaderId,
            joinedAt: ctx.nowIso,
            addedBy: ctx.actorId,
            role: "leader",
          },
        ]
      : [],
    schedule: input.schedule,
    location: input.location?.trim() || undefined,
    active: true,
    involvesMinors: input.involvesMinors ?? false,
    createdAt: ctx.nowIso,
  };

  let next = patch(snapshot, { groups: [...snapshot.groups, group] });
  if (input.leaderId) {
    next = withPerson(
      next,
      input.leaderId,
      (person) => ({ ...person, groupIds: [...person.groupIds, group.id] }),
      ctx,
    );
  }

  return ok({
    ...result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "group.created",
          category: "group",
          summary: `${group.name} was created.`,
          meta: { groupId: group.id },
        }),
      ]),
      [],
      [`${group.name} created.`],
    ),
    groupId: group.id,
  });
}

/**
 * Adds someone to a group. This is always an explicit action by a named
 * person — nobody is ever added to a group automatically.
 */
export function addGroupMember(
  snapshot: ChurchSnapshot,
  groupId: GroupId,
  personId: PersonId,
  role: "member" | "leader" | "assistant" = "member",
  ctx: CommandContext,
): Result<CommandResult> {
  const group = snapshot.groups.find((entry) => entry.id === groupId);
  if (!group) return err("That group no longer exists.", "not_found");
  if (!group.active) return err(`${group.name} is not currently active.`, "inactive");

  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");
  if (!canJoinGroups(person)) {
    return err(
      `${displayName(person)} has moved on from the church, so they can't be added to a group.`,
      "inactive",
    );
  }
  if (group.members.some((member) => member.personId === personId)) {
    return err(`${displayName(person)} is already in ${group.name}.`, "duplicate");
  }

  // A group has one leader: adding a new leader steps the current one down.
  let next = patch(snapshot, {
    groups: replaceById(snapshot.groups, groupId, (entry) => ({
      ...entry,
      members: [
        ...entry.members.map((member) =>
          role === "leader" && member.role === "leader"
            ? { ...member, role: "member" as const }
            : member,
        ),
        { personId, joinedAt: ctx.nowIso, addedBy: ctx.actorId, role },
      ],
      leaderId: role === "leader" ? personId : entry.leaderId,
    })),
  });

  next = withPerson(
    next,
    personId,
    (entry) => ({
      ...entry,
      groupIds: entry.groupIds.includes(groupId) ? entry.groupIds : [...entry.groupIds, groupId],
    }),
    ctx,
  );

  // Settling into a group is the point at which a visitor is "connected".
  const stage = advanceStage(next.settings, person, "connected");
  if (stage) {
    next = withPerson(
      next,
      personId,
      (entry) => ({
        ...entry,
        visitor: entry.visitor
          ? { ...entry.visitor, stageId: stage, stageUpdatedAt: ctx.nowIso }
          : entry.visitor,
      }),
      ctx,
    );
  }

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "group.joined",
          category: "group",
          personId,
          summary: `${displayName(person)} joined ${group.name}.`,
          meta: { groupId },
        }),
      ]),
      [],
      [`${displayName(person)} added to ${group.name}.`],
    ),
  );
}

export function removeGroupMember(
  snapshot: ChurchSnapshot,
  groupId: GroupId,
  personId: PersonId,
  ctx: CommandContext,
): Result<CommandResult> {
  const group = snapshot.groups.find((entry) => entry.id === groupId);
  if (!group) return err("That group no longer exists.", "not_found");
  if (!group.members.some((member) => member.personId === personId)) {
    return err("That person is not in this group.", "not_found");
  }

  const person = findPerson(snapshot, personId);

  let next = patch(snapshot, {
    groups: replaceById(snapshot.groups, groupId, (entry) => ({
      ...entry,
      members: entry.members.filter((member) => member.personId !== personId),
      leaderId: entry.leaderId === personId ? undefined : entry.leaderId,
    })),
  });

  next = withPerson(
    next,
    personId,
    (entry) => ({
      ...entry,
      groupIds: entry.groupIds.filter((id) => id !== groupId),
    }),
    ctx,
  );

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "group.left",
          category: "group",
          personId,
          summary: `${person ? displayName(person) : "A member"} left ${group.name}.`,
          meta: { groupId },
        }),
      ]),
      [],
      ["Group membership updated."],
    ),
  );
}

export function setGroupLeader(
  snapshot: ChurchSnapshot,
  groupId: GroupId,
  personId: PersonId,
  ctx: CommandContext,
): Result<CommandResult> {
  const group = snapshot.groups.find((entry) => entry.id === groupId);
  if (!group) return err("That group no longer exists.", "not_found");

  const person = findPerson(snapshot, personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  if (group.leaderId === personId) {
    return err(`${displayName(person)} already leads ${group.name}.`, "unchanged");
  }
  if (!group.members.some((member) => member.personId === personId)) {
    return addGroupMember(snapshot, groupId, personId, "leader", ctx);
  }

  const next = patch(snapshot, {
    groups: replaceById(snapshot.groups, groupId, (entry) => ({
      ...entry,
      leaderId: personId,
      members: entry.members.map((member) =>
        member.personId === personId
          ? { ...member, role: "leader" as const }
          : member.role === "leader"
            ? { ...member, role: "member" as const }
            : member,
      ),
    })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "group.leader_changed",
          category: "group",
          personId,
          summary: `${displayName(person)} is now leading ${group.name}.`,
          meta: { groupId },
        }),
      ]),
      [],
      [`${displayName(person)} is now leading ${group.name}.`],
    ),
  );
}

/** Pauses or restarts a group, recording who did it on the timeline. */
export function setGroupActive(
  snapshot: ChurchSnapshot,
  groupId: GroupId,
  active: boolean,
  ctx: CommandContext,
): Result<CommandResult> {
  const group = snapshot.groups.find((entry) => entry.id === groupId);
  if (!group) return err("That group no longer exists.", "not_found");
  if (group.active === active) {
    return err(`${group.name} is already ${active ? "active" : "inactive"}.`, "unchanged");
  }

  const next = patch(snapshot, {
    groups: replaceById(snapshot.groups, groupId, (entry) => ({ ...entry, active })),
  });

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "group.status_changed",
          category: "group",
          summary: `${group.name} was ${active ? "restarted" : "marked as not meeting"}.`,
          meta: { groupId },
        }),
      ]),
      [],
      [`${group.name} marked as ${active ? "active" : "inactive"}.`],
    ),
  );
}

/**
 * Current members with no active group — the people most at risk of
 * drifting. Same predicate as the Members filter and Reports.
 */
export function peopleWithoutGroup(snapshot: ChurchSnapshot): Person[] {
  const activeIds = activeGroupIds(snapshot);
  return snapshot.people.filter((person) => isUnconnectedMember(person, activeIds));
}
