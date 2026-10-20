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
  startTask,
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

  it("records a pastoral-care contact as restricted history, and other follow-ups as general", () => {
    const pastoral = unwrap(
      createFollowUpTask(base(), { personId: "person_visitor", type: "pastoral_contact" }, ctx()),
    );
    expect(pastoral.snapshot.activity[0].visibility).toBe("restricted");

    const call = unwrap(createFollowUpTask(base(), { personId: "person_visitor", type: "phone_call" }, ctx()));
    expect(call.snapshot.activity[0].visibility).toBe("general");
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

describe("startTask", () => {
  it("marks an open task as in progress without touching the input", () => {
    const input = snapshot({ people: [visitor()], tasks: [task()] });
    const outcome = unwrap(startTask(input, "task_fixture"));
    expect(outcome.snapshot.tasks[0].status).toBe("in_progress");
    expect(isOpen(outcome.snapshot.tasks[0])).toBe(true);
    expect(outcome.notices).toEqual(["FU-0001 marked as in progress."]);
    expect(input.tasks[0].status).toBe("pending");
  });

  it.each([
    ["an unknown task", [task()], "nope", "not_found"],
    ["a cancelled task", [task({ status: "cancelled" })], "task_fixture", "closed"],
  ])("refuses %s", (_label, tasks, id, code) => {
    const outcome = startTask(snapshot({ tasks }), id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });
});

describe("task command refusals and wording", () => {
  const base = () => snapshot({ people: [visitor()], tasks: [task({ notes: "Prefers mornings" })] });

  it("refuses to create a task for someone not in the directory", () => {
    const outcome = createFollowUpTask(base(), { personId: "nobody", type: "check_in" }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });

  it("creates with explicit due date, priority, assignee and notes", () => {
    const outcome = unwrap(
      createFollowUpTask(
        snapshot({ people: [visitor()] }),
        {
          personId: "person_visitor",
          type: "group_invitation",
          dueDate: "2026-10-20",
          priority: "high",
          assigneeId: TEAM_IDS.coordinator,
          notes: "Riverside group",
          origin: "rule:first_visit_welcome",
          automationKey: "key-1",
        },
        ctx(),
      ),
    );
    expect(outcome.snapshot.tasks[0]).toMatchObject({
      dueDate: "2026-10-20",
      priority: "high",
      assigneeId: TEAM_IDS.coordinator,
      notes: "Riverside group",
      origin: "rule:first_visit_welcome",
      automationKey: "key-1",
    });
    expect(outcome.snapshot.activity[0].summary).toBe(
      "FU-0001: invitation to a group created for Tunde Balogun.",
    );
    expect(outcome.notices).toEqual([
      "FU-0001 created for Tunde Balogun, assigned to Grace Mensah, due 20 Oct 2026.",
    ]);
  });

  it("unassigns a task", () => {
    const outcome = unwrap(assignTask(base(), "task_fixture", undefined, ctx()));
    expect(outcome.snapshot.tasks[0].assigneeId).toBeUndefined();
    expect(outcome.notices).toEqual(["FU-0001 unassigned."]);
    expect(outcome.snapshot.activity[0].summary).toBe("FU-0001 was unassigned.");
  });

  it("names the person when assigning, and copes when the person is gone", () => {
    const named = unwrap(assignTask(base(), "task_fixture", TEAM_IDS.coordinator, ctx()));
    expect(named.snapshot.activity[0].summary).toBe("FU-0001 assigned to Grace Mensah for Tunde Balogun.");

    const orphan = unwrap(assignTask(snapshot({ tasks: [task()] }), "task_fixture", TEAM_IDS.coordinator, ctx()));
    expect(orphan.snapshot.activity[0].summary).toBe("FU-0001 assigned to Grace Mensah.");
  });

  it.each([
    ["an unknown task", "nope", TEAM_IDS.coordinator],
    ["an unknown team member", "task_fixture", "tm_ghost"],
  ])("refuses to assign %s", (_label, taskId, assigneeId) => {
    const outcome = assignTask(base(), taskId, assigneeId, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });

  it.each([
    ["an unknown task", [task()], "nope", "not_found"],
    ["a completed task", [task({ status: "completed" })], "task_fixture", "closed"],
  ])("refuses to reschedule %s", (_label, tasks, id, code) => {
    const outcome = rescheduleTask(snapshot({ tasks }), id, "2026-10-30", undefined, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });

  it("records a reschedule without a reason", () => {
    const outcome = unwrap(rescheduleTask(base(), "task_fixture", "2026-10-30", undefined, ctx()));
    expect(outcome.snapshot.activity[0].summary).toBe("FU-0001 moved to 30 Oct 2026.");
    expect(outcome.notices).toEqual(["FU-0001 moved to 30 Oct 2026."]);
  });

  it("appends the cancellation reason to existing notes, and leaves notes alone without one", () => {
    const withReason = unwrap(cancelTask(base(), "task_fixture", "Moved away", ctx()));
    expect(withReason.snapshot.tasks[0].notes).toBe("Prefers mornings\nCancelled: Moved away");
    expect(withReason.snapshot.activity[0].summary).toBe("FU-0001 was cancelled — Moved away.");

    const withoutReason = unwrap(cancelTask(base(), "task_fixture", undefined, ctx()));
    expect(withoutReason.snapshot.tasks[0].notes).toBe("Prefers mornings");
    expect(withoutReason.snapshot.activity[0].summary).toBe("FU-0001 was cancelled.");
    expect(withoutReason.notices).toEqual(["FU-0001 cancelled."]);
  });

  it("refuses to cancel an unknown task", () => {
    const outcome = cancelTask(base(), "nope", undefined, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });

  it("bulk creation pluralises and names unknown ids it skipped", () => {
    const outcome = createTasksForPeople(
      snapshot({ people: [visitor(), visitor({ id: "p2", firstName: "Ada" })] }),
      ["person_visitor", "p2", "ghost"],
      { type: "check_in" },
      ctx(),
    );
    expect(outcome.snapshot.tasks.map((entry) => entry.reference)).toEqual(["FU-0001", "FU-0002"]);
    expect(outcome.notices).toEqual(["2 follow-up tasks created.", "Skipped 1: ghost."]);
  });

  it("bulk creation reports nothing skipped when everything worked", () => {
    const outcome = createTasksForPeople(snapshot({ people: [visitor()] }), ["person_visitor"], { type: "check_in" }, ctx());
    expect(outcome.notices).toEqual(["1 follow-up task created."]);
  });
});

describe("audit fixes: consent, owners, dates and cancelling", () => {
  const noPermission = () =>
    snapshot({
      people: [visitor({ contact: { preferredMethod: "phone", permissionGranted: false, optedOut: false } })],
    });

  it("refuses a messaging follow-up for somebody who never agreed to be contacted", () => {
    const outcome = createFollowUpTask(noPermission(), { personId: "person_visitor", type: "welcome_message" }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("no_permission");
      expect(outcome.error).toContain("Say hello in person");
    }
  });

  it("allows a hello in person for somebody who never agreed to be contacted", () => {
    const outcome = unwrap(
      createFollowUpTask(noPermission(), { personId: "person_visitor", type: "say_hello" }, ctx()),
    );
    expect(outcome.snapshot.tasks[0].type).toBe("say_hello");
  });

  it("leaves a task unassigned, and says so, rather than give it to an inactive person", () => {
    const outcome = unwrap(
      createFollowUpTask(
        base(),
        { personId: "person_visitor", type: "phone_call", assigneeId: TEAM_IDS.volunteerEsther },
        ctx(),
      ),
    );
    expect(outcome.snapshot.tasks[0].assigneeId).toBeUndefined();
    expect(outcome.notices).toEqual([
      "FU-0001 created for Tunde Balogun, with nobody assigned yet, due 15 Oct 2026.",
      "Esther Bello is inactive, so FU-0001 has been left with nobody assigned.",
    ]);
  });

  it("refuses an unknown person picked by hand, but lets a rule fall back to nobody", () => {
    const manual = createFollowUpTask(base(), { personId: "person_visitor", type: "phone_call", assigneeId: "tm_ghost" }, ctx());
    expect(manual.ok).toBe(false);
    if (!manual.ok) expect(manual.code).toBe("not_found");

    const fromRule = unwrap(
      createFollowUpTask(
        base(),
        { personId: "person_visitor", type: "phone_call", assigneeId: "tm_ghost", origin: "rule:first_visit_welcome" },
        ctx(),
      ),
    );
    expect(fromRule.snapshot.tasks[0].assigneeId).toBeUndefined();
  });

  it("refuses a due date in the past when creating or rescheduling", () => {
    const created = createFollowUpTask(base(), { personId: "person_visitor", type: "phone_call", dueDate: "2026-10-01" }, ctx());
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe("invalid");

    const withTask = snapshot({ people: [visitor()], tasks: [task()] });
    const moved = rescheduleTask(withTask, "task_fixture", "2026-10-01", undefined, ctx());
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.code).toBe("invalid");

    // Today itself is fine.
    expect(createFollowUpTask(base(), { personId: "person_visitor", type: "phone_call", dueDate: TODAY }, ctx()).ok).toBe(true);
  });

  it("refuses to cancel a task that is already cancelled", () => {
    const once = unwrap(cancelTask(snapshot({ people: [visitor()], tasks: [task()] }), "task_fixture", undefined, ctx()));
    const twice = cancelTask(once.snapshot, "task_fixture", undefined, ctx());
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.code).toBe("closed");
  });
});
