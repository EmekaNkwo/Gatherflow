import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import {
  acceptCommands,
  freezeTime,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  toastMock,
} from "@/tests/hooks-harness";
import { useFollowUps, usePersonTasks } from "./useFollowUps";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const OPEN = ["pending", "in_progress", "rescheduled"];

beforeEach(() => freezeTime());
afterEach(resetHarness);

describe("useFollowUps scoping", () => {
  it("shows an administrator every task in the church", () => {
    const snapshot = seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin });
    const { result } = renderHook(() => useFollowUps());

    expect(result.current.scope).toBe("all");
    expect(result.current.tasks).toHaveLength(snapshot.tasks.length);
    expect(result.current.counts.open).toBe(
      snapshot.tasks.filter((task) => OPEN.includes(task.status)).length,
    );
    expect(result.current.counts.unassigned).toBe(
      snapshot.tasks.filter((task) => !task.assigneeId && OPEN.includes(task.status)).length,
    );
    expect(result.current.counts.completed).toBe(
      snapshot.tasks.filter((task) => task.status === "completed").length,
    );
  });

  it("shows a volunteer only their own tasks and counts", () => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useFollowUps());

    expect(result.current.scope).toBe("own");
    expect(result.current.tasks).toHaveLength(23);
    expect(new Set(result.current.tasks.map((entry) => entry.task.assigneeId))).toEqual(
      new Set([TEAM_IDS.volunteerAmara]),
    );
    expect(result.current.counts).toEqual({
      open: 6,
      dueToday: 2,
      overdue: 1,
      unassigned: 0,
      completed: 17,
    });
  });

  it("does not let a volunteer widen the scope by asking for someone else's tasks", () => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() =>
      useFollowUps({ assigneeId: TEAM_IDS.volunteerTunde, due: "today" }),
    );

    expect(result.current.tasks.map((entry) => entry.task.id).sort()).toEqual(["task_19", "task_23"]);
  });

  it("applies a coordinator's own filters across the whole church", () => {
    seedChurch({ role: "follow_up_coordinator", teamMemberId: TEAM_IDS.coordinator });
    const { result } = renderHook(() => useFollowUps({ assigneeId: TEAM_IDS.volunteerTunde }));

    expect(result.current.tasks).toHaveLength(22);
    expect(result.current.tasks.every((entry) => entry.task.assigneeId === TEAM_IDS.volunteerTunde)).toBe(true);
  });

  it("gives a plain member no tasks at all", () => {
    seedChurch({ role: "member", teamMemberId: TEAM_IDS.member });
    const { result } = renderHook(() => useFollowUps());

    expect(result.current.scope).toBe("none");
    expect(result.current.tasks).toEqual([]);
    expect(result.current.counts).toEqual({
      open: 0,
      dueToday: 0,
      overdue: 0,
      unassigned: 0,
      completed: 0,
    });
  });

  it("reports church-wide completion rates and per-volunteer workloads", () => {
    seedChurch({ role: "administrator" });
    const { result } = renderHook(() => useFollowUps());

    const amara = result.current.workloads.find((entry) => entry.member.id === TEAM_IDS.volunteerAmara);
    expect(amara).toMatchObject({ assigned: 6, dueToday: 2, overdue: 1, completed: 17 });

    const snapshot = seedChurch({ role: "administrator" });
    const concluded = snapshot.tasks.filter((task) => ["completed", "cancelled"].includes(task.status));
    expect(result.current.rates.completed).toMatchObject({
      numerator: snapshot.tasks.filter((task) => task.status === "completed").length,
      denominator: concluded.length,
    });
  });
});

describe("useFollowUps actions", () => {
  beforeEach(() => {
    seedChurch({ role: "follow_up_coordinator", teamMemberId: TEAM_IDS.coordinator });
    acceptCommands({ notices: ["Done."] });
  });

  type Hook = ReturnType<typeof useFollowUps>;
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    [
      "create",
      (hook) => hook.create({ personId: "person_1", type: "phone_call", dueDate: "2026-10-14" } as never),
      "task.create",
      { personId: "person_1", type: "phone_call", dueDate: "2026-10-14" },
    ],
    [
      "complete",
      (hook) => hook.complete("task_19", "contacted", "Spoke on the phone"),
      "task.complete",
      { taskId: "task_19", outcome: "contacted", outcomeNote: "Spoke on the phone" },
    ],
    [
      "reschedule",
      (hook) => hook.reschedule("task_19", "2026-10-20", "Away"),
      "task.reschedule",
      { taskId: "task_19", dueDate: "2026-10-20", reason: "Away" },
    ],
    [
      "assign",
      (hook) => hook.assign("task_19", TEAM_IDS.volunteerTunde),
      "task.assign",
      { taskId: "task_19", assigneeId: TEAM_IDS.volunteerTunde },
    ],
    ["start", (hook) => hook.start("task_19"), "task.start", { taskId: "task_19" }],
    [
      "cancel",
      (hook) => hook.cancel("task_19", "Duplicate"),
      "task.cancel",
      { taskId: "task_19", reason: "Duplicate" },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => useFollowUps());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true });
  });

  it("starts a task silently but announces a completion", async () => {
    const { result } = renderHook(() => useFollowUps());

    await invoke(() => result.current.start("task_19"));
    expect(toastMock.success).not.toHaveBeenCalled();

    await invoke(() => result.current.complete("task_19", "contacted"));
    expect(toastMock.success).toHaveBeenCalledWith("Done.", { description: undefined });
  });

  it("returns the server's refusal and shows it", async () => {
    refuseCommands("That task is already closed.", "invalid_state");
    const { result } = renderHook(() => useFollowUps());

    const outcome = await invoke(() => result.current.cancel("task_1"));

    expect(outcome).toEqual({ ok: false, error: "That task is already closed.", code: "invalid_state" });
    expect(toastMock.error).toHaveBeenCalledWith("That task is already closed.");
  });
});

describe("usePersonTasks", () => {
  it("lists one person's tasks, earliest due first", () => {
    const snapshot = seedChurch();
    const personId = snapshot.tasks[0].personId;
    const { result } = renderHook(() => usePersonTasks(personId));

    const expected = snapshot.tasks.filter((task) => task.personId === personId);
    expect(result.current).toHaveLength(expected.length);
    expect(result.current.every((entry) => entry.task.personId === personId)).toBe(true);
    const dates = result.current.map((entry) => entry.task.dueDate);
    expect(dates).toEqual([...dates].sort());
  });
});
