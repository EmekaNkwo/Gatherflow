import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { ctx, snapshot, task, visitor } from "@/tests/factories";
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
      completeTask(withTask(), { taskId: "task_fixture", outcome: "other" }, ctx()),
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
