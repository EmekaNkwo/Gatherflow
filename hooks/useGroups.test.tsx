import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCommands,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  toastMock,
} from "@/tests/hooks-harness";
import { useGroup, useGroupSchedule, useGroups } from "./useGroups";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

afterEach(resetHarness);

describe("useGroups data", () => {
  it("puts active groups first, alphabetically, and inactive ones last", () => {
    seedChurch();
    const { result } = renderHook(() => useGroups());

    const names = result.current.groups.map((entry) => entry.group.name);
    expect(names.at(-1)).toBe("Men's Breakfast");
    const active = names.slice(0, -1);
    expect(active).toEqual([...active].sort((left, right) => left.localeCompare(right)));
    expect(active[0]).toBe("Children's Ministry");
  });

  it("joins each group to its leader and members, and flags minors", () => {
    seedChurch();
    const { result } = renderHook(() => useGroups());

    const riverside = result.current.groups.find((entry) => entry.group.id === "group_1")!;
    expect(riverside.leader?.id).toBe("person_1");
    expect(riverside.members).toHaveLength(9);
    expect(riverside.members.every((entry) => entry.person !== undefined)).toBe(true);
    expect(riverside.minorsFlag).toBe(false);

    const youth = result.current.groups.find((entry) => entry.group.id === "group_7")!;
    expect(youth.minorsFlag).toBe(true);

    const breakfast = result.current.groups.find((entry) => entry.group.id === "group_10")!;
    expect(breakfast.leader).toBeUndefined();
    expect(breakfast.members).toEqual([]);
  });

  it("drops memberships whose person no longer exists", () => {
    const snapshot = seedChurch();
    const ghost = { ...snapshot.groups[0].members[0], personId: "person_gone" };
    seedChurch({
      snapshot: {
        ...snapshot,
        groups: snapshot.groups.map((group, index) =>
          index === 0 ? { ...group, members: [...group.members, ghost] } : group,
        ),
      },
    });
    const { result } = renderHook(() => useGroups());

    expect(result.current.groups.find((entry) => entry.group.id === "group_1")?.members).toHaveLength(9);
  });

  it("lists current members who belong to no active group", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useGroups());

    const activeIds = new Set(snapshot.groups.filter((group) => group.active).map((group) => group.id));
    expect(result.current.unconnected.length).toBeGreaterThan(0);
    for (const person of result.current.unconnected) {
      expect(person.kind).toBe("member");
      expect(person.groupIds.some((id) => activeIds.has(id))).toBe(false);
    }
  });
});

describe("useGroups actions", () => {
  beforeEach(() => {
    seedChurch({ role: "pastor" });
    acceptCommands({ notices: ["Group updated."] });
  });

  type Hook = ReturnType<typeof useGroups>;
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    [
      "create",
      (hook) => hook.create({ name: "Hospitality Team" } as never),
      "group.create",
      { name: "Hospitality Team" },
    ],
    [
      "addMember (default role)",
      (hook) => hook.addMember("group_1", "person_3"),
      "group.addMember",
      { groupId: "group_1", personId: "person_3", role: "member" },
    ],
    [
      "addMember as assistant",
      (hook) => hook.addMember("group_1", "person_3", "assistant"),
      "group.addMember",
      { groupId: "group_1", personId: "person_3", role: "assistant" },
    ],
    [
      "removeMember",
      (hook) => hook.removeMember("group_1", "person_2"),
      "group.removeMember",
      { groupId: "group_1", personId: "person_2" },
    ],
    [
      "assignLeader",
      (hook) => hook.assignLeader("group_10", "person_4"),
      "group.setLeader",
      { groupId: "group_10", personId: "person_4" },
    ],
    [
      "setActive",
      (hook) => hook.setActive("group_10", true),
      "group.setActive",
      { groupId: "group_10", active: true },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => useGroups());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true });
    expect(toastMock.success).toHaveBeenCalledWith("Group updated.", { description: undefined });
  });

  it("returns a refusal and shows it", async () => {
    refuseCommands("A minors group needs two leaders.", "safeguarding");
    const { result } = renderHook(() => useGroups());

    const outcome = await invoke(() => result.current.removeMember("group_7", "person_47"));

    expect(outcome).toMatchObject({ ok: false, code: "safeguarding" });
    expect(toastMock.error).toHaveBeenCalledWith("A minors group needs two leaders.");
  });
});

describe("useGroup and useGroupSchedule", () => {
  it("finds one group by id, or nothing", () => {
    seedChurch();
    expect(renderHook(() => useGroup("group_3")).result.current?.group.name).toBe("Worship Team");
    expect(renderHook(() => useGroup("group_missing")).result.current).toBeUndefined();
  });

  it("schedules only active groups that have a schedule", () => {
    seedChurch();
    const { result } = renderHook(() => useGroupSchedule());

    expect(result.current.map((entry) => entry.group.id)).toEqual([
      "group_1",
      "group_2",
      "group_3",
      "group_4",
      "group_5",
      "group_6",
      "group_7",
      "group_8",
      "group_9",
    ]);
    expect(result.current.every((entry) => entry.schedule === entry.group.schedule)).toBe(true);
  });
});
