import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { ctx, member, NOW, snapshot, task, visitor } from "@/tests/factories";
import type { FollowUpTaskType, TaskOutcome } from "@/types/follow-up";
import type { Person, VisitorProfile } from "@/types/person";
import type { AutomationRuleId } from "@/types/settings";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { DomainEvent } from "../core/events";
import { nextActionFor, runAutomations } from "./rules";

const NOW_ISO = NOW.toISOString();

function v(profile: Partial<VisitorProfile> = {}, rest: Partial<Person> = {}): Person {
  return visitor({ ...rest, visitor: { ...visitor().visitor!, ...profile } });
}

function withRuleDisabled(data: ChurchSnapshot, id: AutomationRuleId): ChurchSnapshot {
  return {
    ...data,
    settings: {
      ...data.settings,
      automationRules: data.settings.automationRules.map((rule) => (rule.id === id ? { ...rule, enabled: false } : rule)),
    },
  };
}

const registered: DomainEvent = { type: "visitor.registered", personId: "person_visitor", firstVisitDate: "2026-10-11" };
const returned: DomainEvent = { type: "visitor.returned", personId: "person_visitor", sessionId: "s1", visitCount: 2 };
const interest: DomainEvent = { type: "visitor.membership_interest", personId: "person_visitor" };
const stopped: DomainEvent = { type: "visitor.follow_up_stopped", personId: "person_visitor" };
const completed = (outcome: TaskOutcome, taskId = "task_fixture"): DomainEvent => ({
  type: "task.completed",
  taskId,
  personId: "person_visitor",
  outcome,
});

describe("nextActionFor", () => {
  it.each<[TaskOutcome, FollowUpTaskType, ReturnType<typeof nextActionFor>]>([
    ["contacted", "welcome_message", { type: "service_invitation", note: "Invite them to the next service.", inDays: 5 }],
    ["contacted", "phone_call", null],
    ["no_answer", "phone_call", { type: "phone_call", note: "Try again at a different time of day.", inDays: 2 }],
    ["requested_another_time", "check_in", { type: "phone_call", note: "Call back at the time they asked for.", inDays: 3 }],
    ["wrong_details", "phone_call", null],
    ["not_interested", "welcome_message", null],
    ["needs_another_team", "welcome_message", null],
    ["other", "welcome_message", null],
  ])("%s after %s", (outcome, type, expected) => {
    expect(nextActionFor(outcome, type)).toEqual(expected);
  });
});

describe("first-visit welcome rule", () => {
  it("creates a high-priority task for the follow-up team when nobody is assigned", () => {
    const outcome = runAutomations(snapshot({ people: [v()] }), [registered], ctx());
    expect(outcome.snapshot.tasks).toHaveLength(1);
    expect(outcome.snapshot.tasks[0]).toMatchObject({
      type: "welcome_message",
      assigneeId: TEAM_IDS.coordinator,
      priority: "high",
      dueDate: "2026-10-14",
      origin: "rule:first_visit_welcome",
      automationKey: "first_visit_welcome:person_visitor:2026-10-11",
    });
    expect(outcome.notices).toEqual(["Welcome follow-up created for Grace Mensah, due 14 Oct 2026."]);
    expect(outcome.events).toEqual([]);
  });

  it("gives the task to the assigned volunteer at normal priority", () => {
    const outcome = runAutomations(snapshot({ people: [v({ assignedTo: TEAM_IDS.volunteerAmara })] }), [registered], ctx());
    expect(outcome.snapshot.tasks[0]).toMatchObject({ assigneeId: TEAM_IDS.volunteerAmara, priority: "normal" });
    expect(outcome.notices).toEqual(["Welcome follow-up created for Amara Nwosu, due 14 Oct 2026."]);
  });

  it("explains why nothing was created for someone who opted out", () => {
    const optedOut = v({}, { contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true } });
    const outcome = runAutomations(snapshot({ people: [optedOut] }), [registered], ctx());
    expect(outcome.snapshot.tasks).toEqual([]);
    expect(outcome.notices).toEqual([
      "Tunde Balogun has asked not to be contacted, so no follow-up task was created.",
    ]);
  });

  it("is silent on a replay of the same event", () => {
    const first = runAutomations(snapshot({ people: [v()] }), [registered], ctx());
    const replay = runAutomations(first.snapshot, [registered], ctx());
    expect(replay.snapshot.tasks).toHaveLength(1);
    expect(replay.notices).toEqual([]);
  });

  it.each([
    ["the rule is disabled", withRuleDisabled(snapshot({ people: [v()] }), "first_visit_welcome"), [registered]],
    ["follow-up stopped in the same batch", snapshot({ people: [v()] }), [registered, stopped]],
    ["the person is gone", snapshot(), [registered]],
  ])("does nothing when %s", (_label, data, events) => {
    const outcome = runAutomations(data, events, ctx());
    expect(outcome.snapshot).toBe(data);
    expect(outcome.notices).toEqual([]);
  });
});

describe("return-visit rule", () => {
  it("moves the visitor to Returned and creates a check-in", () => {
    const input = snapshot({ people: [v({ stageId: "contacted", assignedTo: TEAM_IDS.volunteerAmara })] });
    const outcome = runAutomations(input, [returned], ctx());

    expect(outcome.snapshot.people[0].visitor).toMatchObject({ stageId: "returned", stageUpdatedAt: NOW_ISO });
    expect(outcome.snapshot.tasks[0]).toMatchObject({
      type: "check_in",
      assigneeId: TEAM_IDS.volunteerAmara,
      dueDate: "2026-10-15",
      automationKey: "return_visit_review:person_visitor:2",
      notes: "Returned for visit 2 — ask how they are finding things.",
    });
    expect(outcome.notices).toEqual([
      "Tunde Balogun moved to Returned (visit 2).",
      "Check-in message follow-up for the return visit created for Amara Nwosu, due 15 Oct 2026.",
    ]);
    // Newest first: the task was created after the stage moved.
    expect(outcome.snapshot.activity.map((entry) => entry.summary)).toEqual([
      "FU-0001: check-in message created for Tunde Balogun.",
      'Tunde Balogun came back for visit 2 and moved to "Returned".',
    ]);
    expect(input.people[0].visitor?.stageId).toBe("contacted");
  });

  it("leaves the check-in unassigned when neither the visitor nor the rule names anyone", () => {
    const outcome = runAutomations(snapshot({ people: [v()] }), [returned], ctx());
    expect(outcome.snapshot.tasks[0].assigneeId).toBeUndefined();
  });

  it("records the stage but creates no task when there is open work", () => {
    const outcome = runAutomations(snapshot({ people: [v()], tasks: [task()] }), [returned], ctx());
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("returned");
    expect(outcome.snapshot.tasks).toHaveLength(1);
    expect(outcome.notices).toEqual(["Tunde Balogun moved to Returned (visit 2)."]);
  });

  it("records the stage but creates no task for a closed record", () => {
    const paused = v({ stageId: "contacted", closure: { reason: "paused", recordedAt: NOW_ISO } });
    const outcome = runAutomations(snapshot({ people: [paused] }), [returned], ctx());
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("returned");
    expect(outcome.snapshot.tasks).toEqual([]);
  });

  it("creates no task when follow-up stopped in the same batch", () => {
    const outcome = runAutomations(snapshot({ people: [v()] }), [stopped, returned], ctx());
    expect(outcome.snapshot.tasks).toEqual([]);
  });

  it("leaves someone already settled alone", () => {
    const data = snapshot({ people: [v({ stageId: "connected" })] });
    const outcome = runAutomations(data, [returned], ctx());
    expect(outcome.snapshot).toBe(data);
    expect(outcome.notices).toEqual([]);
  });

  it("ignores a member without a visitor profile", () => {
    const data = snapshot({ people: [member({ id: "person_visitor" })] });
    expect(runAutomations(data, [returned], ctx()).snapshot).toBe(data);
  });

  // Switching the rule off stops the check-in task, not the record of what
  // happened: the visitor still moves to "Returned".
  it("still records the return when the review rule is disabled", () => {
    const data = withRuleDisabled(snapshot({ people: [v({ stageId: "contacted" })] }), "return_visit_review");
    const outcome = runAutomations(data, [returned], ctx());
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("returned");
    expect(outcome.snapshot.tasks).toEqual([]);
  });
});

describe("membership-orientation rule", () => {
  it("creates a high-priority orientation task for the administrator", () => {
    const outcome = runAutomations(snapshot({ people: [v()] }), [interest], ctx());
    expect(outcome.snapshot.tasks[0]).toMatchObject({
      type: "membership_orientation",
      assigneeId: TEAM_IDS.admin,
      priority: "high",
      dueDate: "2026-10-19",
      automationKey: "membership_orientation:person_visitor",
    });
    expect(outcome.notices).toEqual(["A membership orientation task was created for Ruth Adeyemi."]);
  });

  it.each([
    ["disabled", withRuleDisabled(snapshot({ people: [v()] }), "membership_orientation"), [interest]],
    ["stopped", snapshot({ people: [v()] }), [interest, stopped]],
    ["for an unknown person", snapshot(), [interest]],
  ])("does nothing when %s", (_label, data, events) => {
    const outcome = runAutomations(data, events, ctx());
    expect(outcome.snapshot.tasks).toEqual([]);
    expect(outcome.notices).toEqual([]);
  });
});

describe("next-action rule", () => {
  const done = (overrides: Parameters<typeof task>[0] = {}) =>
    task({ status: "completed", outcome: "contacted", completedAt: NOW_ISO, priority: "high", ...overrides });

  it("invites a welcomed visitor to the next service, keeping assignee and priority", () => {
    const outcome = runAutomations(snapshot({ people: [v()], tasks: [done()] }), [completed("contacted")], ctx());
    expect(outcome.snapshot.tasks[1]).toMatchObject({
      type: "service_invitation",
      assigneeId: TEAM_IDS.volunteerAmara,
      priority: "high",
      dueDate: "2026-10-17",
      automationKey: "next_action:task_fixture",
    });
    expect(outcome.notices).toEqual(["Next step created for Amara Nwosu, due 17 Oct 2026: Invite them to the next service."]);
  });

  it("calls back when asked, using the rule's assignee for an unowned task", () => {
    const data = snapshot({ people: [v()], tasks: [done({ type: "phone_call", assigneeId: undefined })] });
    const outcome = runAutomations(data, [completed("requested_another_time")], ctx());
    expect(outcome.snapshot.tasks[1]).toMatchObject({
      type: "phone_call",
      assigneeId: TEAM_IDS.coordinator,
      dueDate: "2026-10-15",
    });
  });

  it.each([
    ["the outcome has no next step", snapshot({ people: [v()], tasks: [done()] }), completed("wrong_details")],
    [
      "the person opted out",
      snapshot({
        people: [v({}, { contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true } })],
        tasks: [done()],
      }),
      completed("no_answer"),
    ],
    [
      "the record is closed",
      snapshot({ people: [v({ closure: { reason: "paused", recordedAt: NOW_ISO } })], tasks: [done()] }),
      completed("no_answer"),
    ],
    ["the task is gone", snapshot({ people: [v()] }), completed("no_answer", "missing")],
    ["the person is gone", snapshot({ tasks: [done()] }), completed("no_answer")],
    ["the rule is disabled", withRuleDisabled(snapshot({ people: [v()], tasks: [done()] }), "next_action_suggestion"), completed("no_answer")],
  ])("does nothing when %s", (_label, data, event) => {
    const outcome = runAutomations(data, [event], ctx());
    expect(outcome.snapshot).toBe(data);
    expect(outcome.notices).toEqual([]);
  });

  it("does nothing once follow-up has stopped in the same batch", () => {
    const data = snapshot({ people: [v()], tasks: [done()] });
    expect(runAutomations(data, [completed("no_answer"), stopped], ctx()).snapshot).toBe(data);
  });
});

describe("events without rules", () => {
  it.each<DomainEvent>([
    { type: "visitor.stage_changed", personId: "person_visitor", stageId: "contacted" },
    { type: "member.registered", personId: "person_visitor" },
    stopped,
  ])("leaves the snapshot alone for $type", (event) => {
    const data = snapshot({ people: [v()] });
    const outcome = runAutomations(data, [event], ctx());
    expect(outcome.snapshot).toBe(data);
    expect(outcome.notices).toEqual([]);
  });

  it("handles an empty batch", () => {
    const data = snapshot();
    expect(runAutomations(data, [], ctx())).toEqual({ snapshot: data, events: [], notices: [] });
  });
});

describe("audit fixes: consent, inactive owners and invitations", () => {
  const noPermission = { contact: { preferredMethod: "sms" as const, permissionGranted: false, optedOut: false } };

  it("creates a hello in person, not a welcome message, without permission to contact", () => {
    const outcome = runAutomations(snapshot({ people: [v({}, noPermission)] }), [registered], ctx());
    expect(outcome.snapshot.tasks[0]).toMatchObject({ type: "say_hello", assigneeId: TEAM_IDS.coordinator });
    expect(outcome.notices).toEqual([
      'They haven\'t agreed to be contacted, so no welcome message will be sent. A "say hello in person" follow-up was created for Grace Mensah, due 14 Oct 2026.',
    ]);
  });

  it("never gives the welcome to an inactive helper, and names nobody", () => {
    const outcome = runAutomations(
      snapshot({ people: [v({ assignedTo: TEAM_IDS.volunteerEsther })] }),
      [registered],
      ctx(),
    );
    expect(outcome.snapshot.tasks[0].assigneeId).toBeUndefined();
    expect(outcome.notices).toEqual([
      "Welcome follow-up created with nobody assigned yet, due 14 Oct 2026.",
      "Esther Bello is inactive, so FU-0001 has been left with nobody assigned.",
    ]);
  });

  it("sets up no next step after a call when they haven't agreed to be contacted", () => {
    const done = task({ status: "completed", outcome: "contacted", completedAt: NOW_ISO });
    const outcome = runAutomations(snapshot({ people: [v({}, noPermission)], tasks: [done] }), [completed("contacted")], ctx());
    expect(outcome.snapshot.tasks).toHaveLength(1);
    expect(outcome.notices).toEqual([
      "No next step was set up, because Tunde Balogun hasn't agreed to be contacted.",
    ]);
  });

  it("closes an open invitation when they come back, then creates the check-in", () => {
    const invitation = task({ type: "service_invitation", reference: "FU-0083" });
    const input = snapshot({ people: [v({ stageId: "contacted", assignedTo: TEAM_IDS.volunteerAmara })], tasks: [invitation] });
    const outcome = runAutomations(input, [returned], ctx());

    expect(outcome.snapshot.tasks[0]).toMatchObject({
      status: "completed",
      outcomeNote: "They came back.",
      completedAt: NOW_ISO,
    });
    expect(outcome.snapshot.tasks[1]).toMatchObject({ type: "check_in", status: "pending" });
    expect(outcome.notices).toContain("FU-0083 closed: they came back.");
  });
});

describe("audit fixes: somebody registered as having been before", () => {
  it("words the welcome for a returning visitor", () => {
    const outcome = runAutomations(snapshot({ people: [v({ returningVisitor: true })] }), [registered], ctx());
    expect(outcome.snapshot.tasks[0].notes).toBe("They've been before: send a welcome-back message.");
    expect(outcome.notices[0]).toBe("Welcome-back follow-up created for Grace Mensah, due 14 Oct 2026.");
  });

  it("handles a return recorded without a service", () => {
    const outcome = runAutomations(
      snapshot({ people: [v({ stageId: "contacted" })] }),
      [{ type: "visitor.returned", personId: "person_visitor", visitCount: 2 }],
      ctx(),
    );
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("returned");
  });
});
