import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { ctx, member, NOW, snapshot, task, visitor } from "@/tests/factories";
import type { TaskOutcome } from "@/types/follow-up";
import { completeTask } from "./completion";
import { isOpen } from "./tasks";

const withTask = (
  people = [visitor()],
  tasks = [task()],
) => snapshot({ people, tasks });

describe("completeTask", () => {
  it("records the outcome, who completed it and when", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "contacted" }, ctx()),
    );

    const completed = outcome.snapshot.tasks[0];
    expect(completed.status).toBe("completed");
    expect(completed.outcome).toBe("contacted");
    expect(completed.completedAt).toBe("2026-10-12T09:00:00.000Z");
    expect(outcome.events).toEqual([
      {
        type: "task.completed",
        taskId: "task_fixture",
        personId: "person_visitor",
        outcome: "contacted",
      },
    ]);
  });

  it("moves a successfully contacted visitor along the pipeline", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "contacted" }, ctx()),
    );

    const person = outcome.snapshot.people[0];
    expect(person.visitor?.stageId).toBe("contacted");
    expect(person.visitor?.contactAttempts).toBe(1);
    expect(person.visitor?.lastContactAt).toBe("2026-10-12T09:00:00.000Z");
  });

  it("records an attempt and the attempted stage when there is no answer", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "no_answer" }, ctx()),
    );

    const person = outcome.snapshot.people[0];
    expect(person.visitor?.stageId).toBe("contact_attempted");
    expect(person.visitor?.contactAttempts).toBe(1);
    expect(person.visitor?.closure).toBeUndefined();
  });

  it("stops follow-up once the agreed number of attempts is reached", () => {
    const persistent = visitor({
      visitor: { ...visitor().visitor!, contactAttempts: 2, stageId: "contact_attempted" },
    });

    const outcome = unwrap(
      completeTask(withTask([persistent]), { taskId: "task_fixture", outcome: "no_answer" }, ctx()),
    );

    const person = outcome.snapshot.people[0];
    expect(person.visitor?.contactAttempts).toBe(3);
    expect(person.visitor?.closure?.reason).toBe("no_response");
    expect(person.visitor?.stageId).toBe("closed");
    expect(outcome.events).toContainEqual({
      type: "visitor.follow_up_stopped",
      personId: "person_visitor",
    });
  });

  it("stops follow-up and cancels other open tasks when someone is not interested", () => {
    const data = withTask(
      [visitor()],
      [task(), task({ id: "task_fixture_2", reference: "FU-0002", type: "service_invitation" })],
    );

    const outcome = unwrap(
      completeTask(data, { taskId: "task_fixture", outcome: "not_interested" }, ctx()),
    );

    expect(outcome.snapshot.people[0].visitor?.closure?.reason).toBe("contact_declined");
    expect(outcome.snapshot.tasks[1].status).toBe("cancelled");
    expect(outcome.snapshot.tasks.filter(isOpen)).toHaveLength(0);
  });

  it("records a referral when another team should take over", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "needs_another_team" }, ctx()),
    );

    expect(outcome.snapshot.people[0].visitor?.closure?.reason).toBe("referred");
  });

  it("asks for the contact details to be checked when they were wrong", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "wrong_details" }, ctx()),
    );

    expect(outcome.notices.join(" ")).toContain("update the contact details");
  });

  it("refuses to complete a task twice", () => {
    const data = withTask([visitor()], [task({ status: "completed" })]);
    const outcome = completeTask(data, { taskId: "task_fixture", outcome: "contacted" }, ctx());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("closed");
  });

  it("leaves a member record alone apart from the task itself", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "other", outcomeNote: "Saw them at the shop" }, ctx()),
    );
    expect(outcome.snapshot.tasks[0].status).toBe("completed");
  });
});

describe("next-action automation", () => {
  it("creates the natural next step after a successful welcome", () => {
    const context = ctx();
    const completed = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "contacted" }, context),
    );
    const automated = runAutomations(completed.snapshot, completed.events, context);

    const created = automated.snapshot.tasks.filter((entry) => entry.origin === "rule:next_action_suggestion");
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("service_invitation");
    expect(created[0].origin).toBe("rule:next_action_suggestion");
  });

  it("retries a phone call after no answer", () => {
    const context = ctx();
    const completed = unwrap(
      completeTask(
        withTask([visitor()], [task({ type: "phone_call" })]),
        { taskId: "task_fixture", outcome: "no_answer" },
        context,
      ),
    );
    const automated = runAutomations(completed.snapshot, completed.events, context);

    const created = automated.snapshot.tasks.filter((entry) => entry.origin === "rule:next_action_suggestion");
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("phone_call");
    expect(created[0].dueDate).toBe("2026-10-14");
  });

  it("never creates another task once follow-up has stopped", () => {
    const context = ctx();
    const completed = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "not_interested" }, context),
    );
    const automated = runAutomations(completed.snapshot, completed.events, context);

    expect(automated.snapshot.tasks.filter((entry) => entry.origin === "rule:next_action_suggestion")).toHaveLength(0);
  });

  it("never creates another task after the attempt limit closes the record", () => {
    const persistent = visitor({
      visitor: { ...visitor().visitor!, contactAttempts: 2, stageId: "contact_attempted" },
    });
    const context = ctx();
    const completed = unwrap(
      completeTask(
        withTask([persistent], [task({ type: "phone_call" })]),
        { taskId: "task_fixture", outcome: "no_answer" },
        context,
      ),
    );
    const automated = runAutomations(completed.snapshot, completed.events, context);

    expect(automated.snapshot.tasks.filter((entry) => entry.origin === "rule:next_action_suggestion")).toHaveLength(0);
  });

  it("is idempotent when the same completion event is replayed", () => {
    const context = ctx();
    const completed = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "contacted" }, context),
    );

    const once = runAutomations(completed.snapshot, completed.events, context);
    const twice = runAutomations(once.snapshot, completed.events, context);

    expect(twice.snapshot.tasks).toHaveLength(once.snapshot.tasks.length);
  });
});

describe("completeTask outcomes", () => {
  const NOW_ISO = NOW.toISOString();

  it.each<[TaskOutcome, number, string, string | undefined, string | undefined]>([
    ["contacted", 1, "contacted", NOW_ISO, undefined],
    ["no_answer", 1, "contact_attempted", NOW_ISO, undefined],
    ["requested_another_time", 1, "contact_attempted", NOW_ISO, undefined],
    ["wrong_details", 1, "contact_attempted", NOW_ISO, undefined],
    // "Something else" is not a try to reach them: no attempt, no move.
    ["other", 0, "new_visitor", undefined, undefined],
    ["not_interested", 0, "closed", undefined, "contact_declined"],
    ["needs_another_team", 0, "closed", undefined, "referred"],
  ])("%s: %i attempt(s), stage %s", (outcome, attempts, stageId, lastContactAt, closure) => {
    const result = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome, outcomeNote: "What happened" }, ctx()),
    );
    const profile = result.snapshot.people[0].visitor!;
    expect(profile.contactAttempts).toBe(attempts);
    expect(profile.stageId).toBe(stageId);
    expect(profile.lastContactAt).toBe(lastContactAt);
    expect(profile.closure?.reason).toBe(closure);
  });

  it("refuses an unknown task or a task whose person was deleted", () => {
    expect(completeTask(withTask(), { taskId: "nope", outcome: "contacted" }, ctx())).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(completeTask(withTask([]), { taskId: "task_fixture", outcome: "contacted" }, ctx())).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("does not touch a member's record for an outcome that is not a contact attempt", () => {
    const data = withTask([member()], [task({ personId: "person_member" })]);
    const outcome = unwrap(completeTask(data, { taskId: "task_fixture", outcome: "not_interested" }, ctx()));
    expect(outcome.snapshot.people).toBe(data.people);
    expect(outcome.events.map((event) => event.type)).toEqual(["task.completed"]);
    expect(outcome.notices).toEqual(["FU-0001 completed — not interested."]);
  });

  it("only stamps a member's record for a contact attempt", () => {
    const data = withTask([member()], [task({ personId: "person_member" })]);
    const outcome = unwrap(completeTask(data, { taskId: "task_fixture", outcome: "contacted" }, ctx()));
    const updated = outcome.snapshot.people[0];
    expect(updated.updatedAt).toBe(NOW_ISO);
    expect({ ...updated, updatedAt: data.people[0].updatedAt }).toEqual(data.people[0]);
    expect(outcome.notices).toEqual(["FU-0001 completed — successfully contacted."]);
    expect(outcome.snapshot.activity).toHaveLength(1);
  });

  it("does not move a visitor out of a terminal stage on success", () => {
    const settled = visitor({ visitor: { ...visitor().visitor!, stageId: "connected" } });
    const outcome = unwrap(completeTask(withTask([settled]), { taskId: "task_fixture", outcome: "contacted" }, ctx()));
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("connected");
    expect(outcome.snapshot.activity.map((entry) => entry.type)).toEqual(["follow_up.completed"]);
  });

  it("logs the stage move alongside the completion", () => {
    const outcome = unwrap(completeTask(withTask(), { taskId: "task_fixture", outcome: "contacted" }, ctx()));
    expect(outcome.snapshot.activity.map((entry) => [entry.type, entry.summary])).toEqual([
      ["follow_up.completed", "FU-0001: welcome message completed for Tunde Balogun — successfully contacted."],
      ["visitor.stage_changed", 'Tunde Balogun moved to "Contacted".'],
    ]);
  });

  it("cancels one other open task, keeping its notes, when someone declines", () => {
    const data = withTask(
      [visitor()],
      [task(), task({ id: "task_other", reference: "FU-0002", notes: "Invite to lunch" }), task({ id: "task_done", status: "completed" })],
    );
    const outcome = unwrap(completeTask(data, { taskId: "task_fixture", outcome: "not_interested" }, ctx()));
    const other = outcome.snapshot.tasks.find((entry) => entry.id === "task_other")!;
    expect(other.status).toBe("cancelled");
    expect(other.notes).toBe("Invite to lunch\nCancelled: follow-up stopped.");
    expect(outcome.snapshot.tasks.find((entry) => entry.id === "task_done")?.status).toBe("completed");
    expect(outcome.notices).toEqual([
      "FU-0001 completed — not interested.",
      "Tunde Balogun is not interested in further contact, so follow-up has stopped.",
      "1 other open task cancelled.",
    ]);
    expect(outcome.snapshot.activity.map((entry) => entry.type)).toEqual(["follow_up.completed", "visitor.closed"]);
  });

  it("keeps the current stage when the church has no terminal stage to close into", () => {
    const base = withTask();
    const data = {
      ...base,
      settings: {
        ...base.settings,
        pipelineStages: base.settings.pipelineStages.filter((stage) => stage.kind !== "terminal"),
      },
    };
    const outcome = unwrap(completeTask(data, { taskId: "task_fixture", outcome: "needs_another_team" }, ctx()));
    expect(outcome.snapshot.people[0].visitor).toMatchObject({
      stageId: "new_visitor",
      closure: { reason: "referred", note: undefined, recordedAt: NOW_ISO },
    });
  });

  it("does not modify the snapshot it was given", () => {
    const data = withTask();
    const before = JSON.stringify(data);
    completeTask(data, { taskId: "task_fixture", outcome: "not_interested" }, ctx());
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("audit fixes: the \"something else\" outcome", () => {
  it("needs a note saying what happened", () => {
    const outcome = completeTask(withTask(), { taskId: "task_fixture", outcome: "other" }, ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });
    const blank = completeTask(withTask(), { taskId: "task_fixture", outcome: "other", outcomeNote: "   " }, ctx());
    expect(blank).toMatchObject({ ok: false, code: "invalid" });
  });

  it("does not bring the attempt limit closer", () => {
    const outcome = unwrap(
      completeTask(withTask(), { taskId: "task_fixture", outcome: "other", outcomeNote: "Met their sister" }, ctx()),
    );
    expect(outcome.snapshot.people[0].visitor?.contactAttempts).toBe(0);
    expect(outcome.snapshot.people[0].visitor?.closure).toBeUndefined();
  });
});
