import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { member, NOW, snapshot, task, TODAY, visitor } from "@/tests/factories";
import type { TaskStatus } from "@/types/follow-up";
import {
  completionRate,
  isDueToday,
  isOverdue,
  needsOwner,
  openTasks,
  overdueTasks,
  selectTasks,
  tasksDueToday,
  tasksForPerson,
  volunteerWorkloads,
  type TaskFilters,
} from "./selectors";

const data = () =>
  snapshot({
    people: [visitor(), member()],
    tasks: [
      task({ id: "t_overdue", reference: "FU-0001", dueDate: "2026-10-08", type: "phone_call", notes: "Ask about the choir" }),
      task({ id: "t_today", reference: "FU-0002", dueDate: TODAY, priority: "urgent", assigneeId: TEAM_IDS.coordinator }),
      task({ id: "t_today_normal", reference: "FU-0003", dueDate: TODAY, personId: "person_member", status: "in_progress" }),
      task({ id: "t_future", reference: "FU-0004", dueDate: "2026-10-30", priority: "high", assigneeId: undefined, status: "rescheduled" }),
      task({ id: "t_done", reference: "FU-0005", dueDate: "2026-10-01", status: "completed", completedAt: "2026-09-30T16:00:00.000Z" }),
      task({ id: "t_cancelled", reference: "FU-0006", dueDate: "2026-09-01", status: "cancelled" }),
      task({ id: "t_orphan", reference: "FU-0007", dueDate: "2026-10-31", personId: "gone", assigneeId: "tm_ghost" }),
    ],
  });

const refs = (rows: { task: { id: string } }[]) => rows.map((row) => row.task.id);

describe("due-date predicates", () => {
  it.each<[TaskStatus, string, boolean, boolean]>([
    ["pending", "2026-10-11", true, false],
    ["in_progress", TODAY, false, true],
    ["rescheduled", "2026-10-13", false, false],
    ["completed", "2026-10-11", false, false],
    ["cancelled", TODAY, false, false],
  ])("%s due %s → overdue %s, due today %s", (status, dueDate, overdue, today) => {
    const entry = task({ status, dueDate });
    expect(isOverdue(entry, TODAY)).toBe(overdue);
    expect(isDueToday(entry, TODAY)).toBe(today);
  });
});

describe("task lists", () => {
  it("lists open, overdue and due-today tasks", () => {
    expect(openTasks(data()).map((entry) => entry.id)).toEqual([
      "t_overdue",
      "t_today",
      "t_today_normal",
      "t_future",
      "t_orphan",
    ]);
    expect(overdueTasks(data(), NOW).map((entry) => entry.id)).toEqual(["t_overdue"]);
    expect(tasksDueToday(data(), NOW).map((entry) => entry.id)).toEqual(["t_today", "t_today_normal"]);
  });

  it("treats a task due yesterday as due today when the clock is still on that day", () => {
    const lateEvening = new Date("2026-10-08T12:00:00.000Z");
    expect(tasksDueToday(data(), lateEvening).map((entry) => entry.id)).toEqual(["t_overdue"]);
    expect(overdueTasks(data(), lateEvening)).toEqual([]);
  });

  it("lists a person's tasks, latest due first", () => {
    expect(tasksForPerson(data(), "person_visitor").map((entry) => entry.id)).toEqual([
      "t_future",
      "t_today",
      "t_overdue",
      "t_done",
      "t_cancelled",
    ]);
    expect(tasksForPerson(data(), "nobody")).toEqual([]);
  });
});

describe("selectTasks", () => {
  it("joins the person and assignee and flags timing", () => {
    const rows = selectTasks(data(), {}, NOW);
    const overdue = rows.find((row) => row.task.id === "t_overdue")!;
    expect(overdue.person?.id).toBe("person_visitor");
    expect(overdue.assigneeName).toBe("Amara Nwosu");
    expect(overdue.overdue).toBe(true);
    expect(overdue.dueToday).toBe(false);

    const orphan = rows.find((row) => row.task.id === "t_orphan")!;
    expect(orphan.person).toBeUndefined();
    expect(orphan.assigneeName).toBeUndefined();

    const unassigned = rows.find((row) => row.task.id === "t_future")!;
    expect(unassigned.assigneeName).toBeUndefined();
  });

  it("sorts by due date and then by priority", () => {
    expect(refs(selectTasks(data(), {}, NOW))).toEqual([
      "t_cancelled",
      "t_done",
      "t_overdue",
      "t_today",
      "t_today_normal",
      "t_future",
      "t_orphan",
    ]);
  });

  it.each<[string, TaskFilters, string[]]>([
    // Finished work: the most recently finished first.
    ["status", { status: ["completed", "cancelled"] }, ["t_done", "t_cancelled"]],
    ["type", { type: ["phone_call"] }, ["t_overdue"]],
    ["priority", { priority: ["urgent", "high"] }, ["t_today", "t_future"]],
    ["person", { personId: "person_member" }, ["t_today_normal"]],
    ["named assignee", { assigneeId: TEAM_IDS.coordinator }, ["t_today"]],
    // Assigned to somebody no longer on the team counts as no owner too.
    ["unassigned", { assigneeId: "unassigned" }, ["t_future", "t_orphan"]],
    ["a single task", { taskId: "t_today" }, ["t_today"]],
    ["overdue", { due: "overdue" }, ["t_overdue"]],
    ["today", { due: "today" }, ["t_today", "t_today_normal"]],
    ["upcoming", { due: "upcoming" }, ["t_future", "t_orphan"]],
    ["all due windows", { due: "all", status: ["pending"] }, ["t_overdue", "t_today", "t_orphan"]],
    ["search by reference", { search: " fu-0004 " }, ["t_future"]],
    ["search by notes", { search: "CHOIR" }, ["t_overdue"]],
    ["search by person name", { search: "grace adeyemi" }, ["t_today_normal"]],
    ["search with no match", { search: "zzz" }, []],
    ["blank search", { search: "   " }, ["t_cancelled", "t_done", "t_overdue", "t_today", "t_today_normal", "t_future", "t_orphan"]],
  ])("filters by %s", (_label, filters, expected) => {
    expect(refs(selectTasks(data(), filters, NOW))).toEqual(expected);
  });

  it("does not reorder the snapshot's tasks", () => {
    const input = data();
    const before = input.tasks.map((entry) => entry.id);
    selectTasks(input, {}, NOW);
    expect(input.tasks.map((entry) => entry.id)).toEqual(before);
  });
});

describe("completionRate", () => {
  const history = () =>
    snapshot({
      tasks: [
        task({ id: "a", status: "completed", dueDate: "2026-09-10", completedAt: "2026-09-09T10:00:00.000Z" }),
        task({ id: "b", status: "completed", dueDate: "2026-09-10", completedAt: "2026-09-20T10:00:00.000Z" }),
        task({ id: "c", status: "cancelled", dueDate: "2026-09-15" }),
        task({ id: "d", status: "completed", dueDate: "2026-10-05", completedAt: "2026-10-05T10:00:00.000Z" }),
        task({ id: "e", status: "pending", dueDate: "2026-09-12" }),
      ],
    });

  it("counts cancelled tasks as concluded but not completed", () => {
    expect(completionRate(history())).toEqual({
      completed: { numerator: 3, denominator: 4, percentage: 75 },
      onTime: { numerator: 2, denominator: 3, percentage: 66.7 },
    });
  });

  it("limits the window by completion date, or due date when never completed", () => {
    expect(completionRate(history(), { from: "2026-09-12", to: "2026-09-30" })).toEqual({
      completed: { numerator: 1, denominator: 2, percentage: 50 },
      onTime: { numerator: 0, denominator: 1, percentage: 0 },
    });
    expect(completionRate(history(), { from: "2026-10-01" }).completed).toEqual({
      numerator: 1,
      denominator: 1,
      percentage: 100,
    });
    expect(completionRate(history(), { to: "2026-09-09" }).onTime.percentage).toBe(100);
  });
});

describe("volunteerWorkloads", () => {
  it("lists every team member, busiest first", () => {
    const workloads = volunteerWorkloads(data(), NOW);
    expect(workloads).toHaveLength(5);
    expect(workloads[0]).toMatchObject({
      member: { id: TEAM_IDS.volunteerAmara },
      assigned: 2,
      dueToday: 1,
      overdue: 1,
      completed: 1,
      completedOnTime: 1,
    });
    expect(workloads[1]).toMatchObject({ member: { id: TEAM_IDS.coordinator }, assigned: 1, dueToday: 1 });
    expect(workloads.slice(2).every((entry) => entry.assigned === 0)).toBe(true);
  });

  it("reports zero work for an empty task list", () => {
    expect(volunteerWorkloads(snapshot(), NOW).every((entry) => entry.assigned === 0 && entry.completed === 0)).toBe(true);
  });
});

describe("audit fixes: owners, search and finished order", () => {
  it("treats open work held by an inactive helper as needing an owner", () => {
    const data = snapshot({
      people: [visitor()],
      tasks: [task({ id: "t_esther", assigneeId: TEAM_IDS.volunteerEsther })],
    });
    expect(needsOwner(data.tasks[0], data)).toBe(true);
    expect(refs(selectTasks(data, { assigneeId: "unassigned" }, NOW))).toEqual(["t_esther"]);
    expect(selectTasks(data, {}, NOW)[0].ownerInactive).toBe(true);
  });

  it("does not flag finished work held by an inactive helper", () => {
    const done = task({ assigneeId: TEAM_IDS.volunteerEsther, status: "completed" });
    expect(needsOwner(done, snapshot())).toBe(false);
  });

  it("finds people by name without accents or apostrophes", () => {
    const data = snapshot({
      people: [visitor({ firstName: "Émilie", lastName: "O'Brien-Núñez" })],
      tasks: [task()],
    });
    expect(selectTasks(data, { search: "emilie obrien" }, NOW)).toHaveLength(1);
  });

  it("lists the most recently completed first", () => {
    const data = snapshot({
      people: [visitor()],
      tasks: [
        task({ id: "old", status: "completed", dueDate: "2026-10-20", completedAt: "2026-10-01T09:00:00.000Z" }),
        task({ id: "new", status: "completed", dueDate: "2026-10-02", completedAt: "2026-10-12T09:00:00.000Z" }),
      ],
    });
    expect(refs(selectTasks(data, { status: ["completed"] }, NOW))).toEqual(["new", "old"]);
  });
});
