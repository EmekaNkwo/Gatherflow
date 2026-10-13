import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { ctx, snapshot, task, TODAY, visitor } from "@/tests/factories";
import {
  assignTask,
  cancelTask,
  createFollowUpTask,
  createTasksForPeople,
  isOpen,
  rescheduleTask,
} from "./tasks";
import { selectTasks, completionRate, volunteerWorkloads } from "./selectors";

const base = () => snapshot({ people: [visitor()] });

describe("createFollowUpTask", () => {
  it("creates a task with a readable reference and the default due window", () => {
    const outcome = unwrap(
      createFollowUpTask(base(), { personId: "person_visitor", type: "phone_call" }, ctx()),
    );

    const created = outcome.snapshot.tasks[0];
    expect(created.reference).toBe("FU-0001");
    expect(created.status).toBe("pending");
    expect(created.dueDate).toBe("2026-10-15"); // today + the 3-day default
    expect(created.origin).toBe("manual");
  });

  it("numbers references from the highest existing one", () => {
    const withExisting = snapshot({
      people: [visitor()],
      tasks: [task({ reference: "FU-0041" })],
    });

    const outcome = unwrap(
      createFollowUpTask(withExisting, { personId: "person_visitor", type: "check_in" }, ctx()),
    );

    expect(outcome.snapshot.tasks[1].reference).toBe("FU-0042");
  });

  it("refuses to create contact tasks for someone who opted out", () => {
    const optedOut = snapshot({
      people: [
        visitor({
          contact: { preferredMethod: "phone", permissionGranted: false, optedOut: true },
        }),
      ],
    });

    const outcome = createFollowUpTask(
      optedOut,
      { personId: "person_visitor", type: "check_in" },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("opted_out");
  });

  it("still allows a pastoral contact for someone who opted out of church messages", () => {
    const optedOut = snapshot({
      people: [
        visitor({
          contact: { preferredMethod: "phone", permissionGranted: false, optedOut: true },
        }),
      ],
    });

    const outcome = createFollowUpTask(
      optedOut,
      { personId: "person_visitor", type: "pastoral_contact" },
      ctx(),
    );

    expect(outcome.ok).toBe(true);
  });

  it("refuses a duplicate automation key", () => {
    const existing = snapshot({
      people: [visitor()],
      tasks: [task({ automationKey: "first_visit_welcome:person_visitor:2026-10-04" })],
    });

    const outcome = createFollowUpTask(
      existing,
      {
        personId: "person_visitor",
        type: "welcome_message",
        automationKey: "first_visit_welcome:person_visitor:2026-10-04",
      },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("duplicate");
  });
});

describe("assignTask", () => {
  it("assigns to an active team member", () => {
    const outcome = unwrap(
      assignTask(
        snapshot({ people: [visitor()], tasks: [task({ assigneeId: undefined })] }),
        "task_fixture",
        TEAM_IDS.volunteerAmara,
        ctx(),
      ),
    );

    expect(outcome.snapshot.tasks[0].assigneeId).toBe(TEAM_IDS.volunteerAmara);
  });

  it("refuses an inactive volunteer", () => {
    const outcome = assignTask(
      snapshot({ people: [visitor()], tasks: [task()] }),
      "task_fixture",
      TEAM_IDS.volunteerEsther,
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("inactive");
  });

  it("refuses to reassign a completed task", () => {
    const outcome = assignTask(
      snapshot({ people: [visitor()], tasks: [task({ status: "completed" })] }),
      "task_fixture",
      TEAM_IDS.volunteerAmara,
      ctx(),
    );

    expect(outcome.ok).toBe(false);
  });
});

describe("rescheduleTask", () => {
  it("moves the due date, keeps the task open and records the history", () => {
    const outcome = unwrap(
      rescheduleTask(
        snapshot({ people: [visitor()], tasks: [task()] }),
        "task_fixture",
        "2026-10-20",
        "Visitor asked for an evening call",
        ctx(),
      ),
    );

    const updated = outcome.snapshot.tasks[0];
    expect(updated.dueDate).toBe("2026-10-20");
    expect(updated.status).toBe("rescheduled");
    expect(isOpen(updated)).toBe(true);
    expect(updated.rescheduleHistory).toEqual([
      {
        from: TODAY,
        to: "2026-10-20",
        at: "2026-10-12T09:00:00.000Z",
        by: TEAM_IDS.coordinator,
        reason: "Visitor asked for an evening call",
      },
    ]);
  });

  it("refuses a no-op reschedule", () => {
    const outcome = rescheduleTask(
      snapshot({ people: [visitor()], tasks: [task()] }),
      "task_fixture",
      TODAY,
      undefined,
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("unchanged");
  });
});

describe("cancelTask", () => {
  it("cancels an open task and keeps the reason", () => {
    const outcome = unwrap(
      cancelTask(
        snapshot({ people: [visitor()], tasks: [task()] }),
        "task_fixture",
        "Visitor moved away",
        ctx(),
      ),
    );

    expect(outcome.snapshot.tasks[0].status).toBe("cancelled");
    expect(outcome.snapshot.tasks[0].notes).toContain("Visitor moved away");
  });

  it("will not cancel something already completed", () => {
    const outcome = cancelTask(
      snapshot({ people: [visitor()], tasks: [task({ status: "completed" })] }),
      "task_fixture",
      undefined,
      ctx(),
    );

    expect(outcome.ok).toBe(false);
  });
});

describe("bulk task creation", () => {
  it("creates what it can and reports who was skipped", () => {
    const people = [
      visitor(),
      visitor({
        id: "person_opted_out",
        firstName: "Bisi",
        contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true },
      }),
    ];

    const outcome = createTasksForPeople(
      snapshot({ people }),
      ["person_visitor", "person_opted_out"],
      { type: "service_invitation" },
      ctx(),
    );

    expect(outcome.snapshot.tasks).toHaveLength(1);
    expect(outcome.notices[0]).toBe("1 follow-up task created.");
    expect(outcome.notices[1]).toContain("Skipped 1");
  });
});

describe("task selectors", () => {
  const data = snapshot({
    people: [visitor()],
    tasks: [
      task({ id: "task_overdue", reference: "FU-0001", dueDate: "2026-10-08" }),
      task({ id: "task_today", reference: "FU-0002", dueDate: TODAY, priority: "urgent" }),
      task({ id: "task_future", reference: "FU-0003", dueDate: "2026-10-30" }),
      task({
        id: "task_done",
        reference: "FU-0004",
        dueDate: "2026-10-01",
        status: "completed",
        completedAt: "2026-09-30T16:00:00.000Z",
        outcome: "contacted",
      }),
      task({
        id: "task_late",
        reference: "FU-0005",
        dueDate: "2026-09-20",
        status: "completed",
        completedAt: "2026-09-25T16:00:00.000Z",
        outcome: "contacted",
      }),
    ],
  });

  it("filters by due window", () => {
    expect(selectTasks(data, { due: "overdue" }, new Date("2026-10-12T09:00:00Z"))).toHaveLength(1);
    expect(selectTasks(data, { due: "today" }, new Date("2026-10-12T09:00:00Z"))).toHaveLength(1);
    expect(selectTasks(data, { due: "upcoming" }, new Date("2026-10-12T09:00:00Z"))).toHaveLength(1);
  });

  it("sorts by due date then priority", () => {
    const rows = selectTasks(data, {}, new Date("2026-10-12T09:00:00Z"));
    expect(rows.map((row) => row.task.reference)).toEqual([
      "FU-0005",
      "FU-0004",
      "FU-0001",
      "FU-0002",
      "FU-0003",
    ]);
  });

  it("reports completion against concluded tasks and on-time against completed ones", () => {
    const rates = completionRate(data);
    expect(rates.completed).toEqual({ numerator: 2, denominator: 2, percentage: 100 });
    expect(rates.onTime).toEqual({ numerator: 1, denominator: 2, percentage: 50 });
  });

  it("returns no percentage when there is nothing to measure", () => {
    expect(completionRate(snapshot()).completed.percentage).toBeNull();
  });

  it("summarises volunteer workload", () => {
    const workloads = volunteerWorkloads(data, new Date("2026-10-12T09:00:00Z"));
    const amara = workloads.find((entry) => entry.member.id === TEAM_IDS.volunteerAmara);
    expect(amara).toMatchObject({ assigned: 3, dueToday: 1, overdue: 1, completed: 2 });
    expect(amara?.completedOnTime).toBe(1);
  });
});
