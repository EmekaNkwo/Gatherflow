import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { ctx, group, member, NOW, snapshot, visitor } from "@/tests/factories";
import type { GroupMembership } from "@/types/group";
import type { Person } from "@/types/person";
import {
  addGroupMember,
  canJoinGroups,
  createGroup,
  peopleWithoutGroup,
  removeGroupMember,
  setGroupActive,
  setGroupLeader,
} from "./groups";

const NOW_ISO = NOW.toISOString();

function membership(personId: string, role: GroupMembership["role"] = "member"): GroupMembership {
  return { personId, role, joinedAt: "2026-01-05T09:00:00.000Z", addedBy: TEAM_IDS.coordinator };
}

function atStage(stageId: string): Person {
  const base = visitor();
  return visitor({ visitor: { ...base.visitor!, stageId } });
}

describe("createGroup", () => {
  it("creates a group with its leader as the first member", () => {
    const input = snapshot({ people: [member()] });
    const outcome = unwrap(
      createGroup(
        input,
        {
          name: "  Young Adults  ",
          description: " Fridays ",
          type: "connect_group",
          leaderId: "person_member",
          location: "   ",
        },
        ctx(),
      ),
    );

    expect(outcome.groupId).toBe("group_1");
    const created = outcome.snapshot.groups[0];
    expect(created).toMatchObject({
      id: "group_1",
      name: "Young Adults",
      description: "Fridays",
      leaderId: "person_member",
      location: undefined,
      active: true,
      involvesMinors: false,
      createdAt: NOW_ISO,
    });
    expect(created.members).toEqual([
      { personId: "person_member", joinedAt: NOW_ISO, addedBy: TEAM_IDS.coordinator, role: "leader" },
    ]);
    expect(outcome.snapshot.people[0].groupIds).toEqual(["group_1"]);
    expect(outcome.notices).toEqual(["Young Adults created."]);
    expect(outcome.snapshot.activity[0]).toMatchObject({ type: "group.created", summary: "Young Adults was created." });
    expect(input.groups).toEqual([]);
    expect(input.people[0].groupIds).toEqual([]);
  });

  it("creates an empty group without a leader and keeps flags", () => {
    const outcome = unwrap(
      createGroup(
        snapshot(),
        { name: "Kids Club", description: "", type: "ministry", location: " Hall B ", involvesMinors: true },
        ctx(),
      ),
    );
    expect(outcome.snapshot.groups[0]).toMatchObject({
      members: [],
      leaderId: undefined,
      location: "Hall B",
      involvesMinors: true,
    });
  });

  it.each([
    ["a blank name", "   ", "invalid"],
    ["a duplicate name in a different case", " riverside connect group ", "duplicate"],
  ])("refuses %s", (_label, name, code) => {
    const outcome = createGroup(snapshot({ groups: [group()] }), { name, description: "", type: "connect_group" }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });
});

describe("addGroupMember", () => {
  it("adds a visitor and marks them as connected", () => {
    const input = snapshot({ people: [atStage("returned")], groups: [group()] });
    const outcome = unwrap(addGroupMember(input, "group_connect", "person_visitor", "member", ctx()));

    expect(outcome.snapshot.groups[0].members).toEqual([
      { personId: "person_visitor", joinedAt: NOW_ISO, addedBy: TEAM_IDS.coordinator, role: "member" },
    ]);
    const person = outcome.snapshot.people[0];
    expect(person.groupIds).toEqual(["group_connect"]);
    expect(person.visitor?.stageId).toBe("connected");
    expect(person.visitor?.stageUpdatedAt).toBe(NOW_ISO);
    expect(outcome.notices).toEqual(["Tunde Balogun added to Riverside Connect Group."]);
    expect(outcome.snapshot.activity[0].summary).toBe("Tunde Balogun joined Riverside Connect Group.");
    expect(input.groups[0].members).toEqual([]);
  });

  it("does not move a closed visitor or a member's stage", () => {
    const closed = unwrap(
      addGroupMember(snapshot({ people: [atStage("closed")], groups: [group()] }), "group_connect", "person_visitor", "member", ctx()),
    );
    expect(closed.snapshot.people[0].visitor?.stageId).toBe("closed");

    const joined = unwrap(
      addGroupMember(snapshot({ people: [member()], groups: [group()] }), "group_connect", "person_member", "member", ctx()),
    );
    expect(joined.snapshot.people[0].visitor).toBeUndefined();
  });

  it("makes a leader the group leader and keeps an existing groupId only once", () => {
    const input = snapshot({ people: [member({ groupIds: ["group_connect"] })], groups: [group()] });
    const outcome = unwrap(addGroupMember(input, "group_connect", "person_member", "leader", ctx()));
    expect(outcome.snapshot.groups[0].leaderId).toBe("person_member");
    expect(outcome.snapshot.people[0].groupIds).toEqual(["group_connect"]);
  });

  it("leaves the leader alone when adding an assistant", () => {
    const input = snapshot({
      people: [member()],
      groups: [group({ leaderId: "lead", members: [membership("lead", "leader")] })],
    });
    const outcome = unwrap(addGroupMember(input, "group_connect", "person_member", "assistant", ctx()));
    expect(outcome.snapshot.groups[0].leaderId).toBe("lead");
    expect(outcome.snapshot.groups[0].members.map((entry) => entry.role)).toEqual(["leader", "assistant"]);
  });

  it.each([
    ["an unknown group", { groups: [group()] }, "group_gone", "person_member", "not_found"],
    ["an inactive group", { groups: [group({ active: false })] }, "group_connect", "person_member", "inactive"],
    ["an unknown person", { groups: [group()] }, "group_connect", "nobody", "not_found"],
    [
      "someone already in the group",
      { groups: [group({ members: [membership("person_member")] })] },
      "group_connect",
      "person_member",
      "duplicate",
    ],
  ])("refuses %s", (_label, overrides, groupId, personId, code) => {
    const outcome = addGroupMember(snapshot({ people: [member()], ...overrides }), groupId, personId, "member", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });
});

describe("removeGroupMember", () => {
  it("removes the person, clears leadership and their groupId", () => {
    const input = snapshot({
      people: [member({ groupIds: ["group_connect", "group_other"] })],
      groups: [
        group({
          leaderId: "person_member",
          members: [membership("person_member", "leader"), membership("someone")],
        }),
      ],
    });
    const outcome = unwrap(removeGroupMember(input, "group_connect", "person_member", ctx()));

    expect(outcome.snapshot.groups[0].members.map((entry) => entry.personId)).toEqual(["someone"]);
    expect(outcome.snapshot.groups[0].leaderId).toBeUndefined();
    expect(outcome.snapshot.people[0].groupIds).toEqual(["group_other"]);
    expect(outcome.notices).toEqual(["Group membership updated."]);
    expect(outcome.snapshot.activity[0].summary).toBe("Grace Adeyemi left Riverside Connect Group.");
  });

  it("keeps another leader in place", () => {
    const input = snapshot({
      people: [member()],
      groups: [group({ leaderId: "lead", members: [membership("lead", "leader"), membership("person_member")] })],
    });
    const outcome = unwrap(removeGroupMember(input, "group_connect", "person_member", ctx()));
    expect(outcome.snapshot.groups[0].leaderId).toBe("lead");
  });

  it("still removes a membership whose person record is gone", () => {
    const input = snapshot({ groups: [group({ members: [membership("ghost")] })] });
    const outcome = unwrap(removeGroupMember(input, "group_connect", "ghost", ctx()));
    expect(outcome.snapshot.groups[0].members).toEqual([]);
    expect(outcome.snapshot.activity[0].summary).toBe("A member left Riverside Connect Group.");
  });

  it.each([
    ["an unknown group", "group_gone"],
    ["someone not in the group", "group_connect"],
  ])("refuses %s", (_label, groupId) => {
    const outcome = removeGroupMember(snapshot({ people: [member()], groups: [group()] }), groupId, "person_member", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("setGroupLeader", () => {
  it("promotes an existing member and demotes the previous leader", () => {
    const input = snapshot({
      people: [member()],
      groups: [
        group({
          leaderId: "lead",
          members: [membership("lead", "leader"), membership("person_member"), membership("helper", "assistant")],
        }),
      ],
    });
    const outcome = unwrap(setGroupLeader(input, "group_connect", "person_member", ctx()));

    const updated = outcome.snapshot.groups[0];
    expect(updated.leaderId).toBe("person_member");
    expect(updated.members.map((entry) => [entry.personId, entry.role])).toEqual([
      ["lead", "member"],
      ["person_member", "leader"],
      ["helper", "assistant"],
    ]);
    expect(outcome.notices).toEqual(["Grace Adeyemi is now leading Riverside Connect Group."]);
    expect(input.groups[0].leaderId).toBe("lead");
  });

  it("adds a non-member as leader", () => {
    const outcome = unwrap(
      setGroupLeader(snapshot({ people: [member()], groups: [group()] }), "group_connect", "person_member", ctx()),
    );
    expect(outcome.snapshot.groups[0].leaderId).toBe("person_member");
    expect(outcome.snapshot.groups[0].members[0].role).toBe("leader");
    expect(outcome.notices).toEqual(["Grace Adeyemi added to Riverside Connect Group."]);
  });

  it.each([
    ["an unknown group", "group_gone", "person_member"],
    ["an unknown person", "group_connect", "nobody"],
  ])("refuses %s", (_label, groupId, personId) => {
    const outcome = setGroupLeader(snapshot({ people: [member()], groups: [group()] }), groupId, personId, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("setGroupActive", () => {
  it.each([
    [false, "Riverside Connect Group marked as inactive."],
    [true, "Riverside Connect Group marked as active."],
  ])("sets active=%s", (active, notice) => {
    const outcome = unwrap(setGroupActive(snapshot({ groups: [group({ active: !active })] }), "group_connect", active, ctx()));
    expect(outcome.snapshot.groups[0].active).toBe(active);
    expect(outcome.notices).toEqual([notice]);
    // L2: pausing or restarting a group leaves a record of who did it.
    expect(outcome.snapshot.activity[0]).toMatchObject({
      type: "group.status_changed",
      actorId: TEAM_IDS.coordinator,
      meta: { groupId: "group_connect" },
    });
  });

  it("refuses an unknown group", () => {
    const outcome = setGroupActive(snapshot(), "group_gone", true, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("peopleWithoutGroup", () => {
  it("lists current members with no active group", () => {
    const base = member().member!;
    const data = snapshot({
      groups: [group({ id: "g_active" }), group({ id: "g_closed", name: "Old", active: false })],
      people: [
        member({ id: "in_active_group", groupIds: ["g_active"] }),
        member({ id: "only_closed_group", groupIds: ["g_closed"] }),
        member({ id: "no_group" }),
        member({ id: "archived", member: { ...base, status: "archived" } }),
        member({ id: "transferred", member: { ...base, status: "transferred" } }),
        member({ id: "inactive", member: { ...base, status: "inactive" } }),
        visitor({ id: "a_visitor" }),
      ],
    });
    expect(peopleWithoutGroup(data).map((person) => person.id)).toEqual([
      "only_closed_group",
      "no_group",
      "inactive",
    ]);
  });

  it("is empty for an empty directory", () => {
    expect(peopleWithoutGroup(snapshot())).toEqual([]);
  });
});

describe("leadership history and the one-leader rule (L2)", () => {
  it("records a leader change on the timeline", () => {
    const data = snapshot({
      people: [member()],
      groups: [group({ members: [membership("person_member")] })],
    });
    const outcome = unwrap(setGroupLeader(data, "group_connect", "person_member", ctx()));
    expect(outcome.snapshot.activity[0]).toMatchObject({
      type: "group.leader_changed",
      personId: "person_member",
      actorId: TEAM_IDS.coordinator,
    });
  });

  it("refuses to make the current leader leader again", () => {
    const data = snapshot({
      people: [member()],
      groups: [group({ leaderId: "person_member", members: [membership("person_member", "leader")] })],
    });
    const outcome = setGroupLeader(data, "group_connect", "person_member", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("unchanged");
  });

  it("adding someone as leader steps the existing leader down", () => {
    const data = snapshot({
      people: [member({ id: "old_lead" }), member({ id: "new_lead" })],
      groups: [group({ leaderId: "old_lead", members: [membership("old_lead", "leader")] })],
    });
    const outcome = unwrap(addGroupMember(data, "group_connect", "new_lead", "leader", ctx()));
    const members = outcome.snapshot.groups[0].members;
    expect(outcome.snapshot.groups[0].leaderId).toBe("new_lead");
    expect(members.filter((entry) => entry.role === "leader").map((entry) => entry.personId)).toEqual([
      "new_lead",
    ]);
  });
});

describe("people who have left can't join a group (L3)", () => {
  it.each(["transferred", "archived"] as const)("refuses a %s member", (status) => {
    const base = member().member!;
    const data = snapshot({
      people: [member({ member: { ...base, status } })],
      groups: [group()],
    });
    const outcome = addGroupMember(data, "group_connect", "person_member", "member", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("inactive");
      expect(outcome.error).toContain("moved on");
    }
  });

  it("canJoinGroups allows visitors and current members", () => {
    const base = member().member!;
    expect(canJoinGroups(visitor())).toBe(true);
    expect(canJoinGroups(member({ member: { ...base, status: "inactive" } }))).toBe(true);
    expect(canJoinGroups(member({ member: { ...base, status: "transferred" } }))).toBe(false);
  });
});
