import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { ctx, member, NOW, snapshot, task, visitor } from "@/tests/factories";
import type { PipelineStage } from "@/types/follow-up";
import type { Person } from "@/types/person";
import {
  advanceStage,
  assignVisitor,
  closeFollowUp,
  closureStage,
  findStage,
  isTerminalStage,
  orderedStages,
  reopenFollowUp,
  setContactPreferences,
  setStage,
  stageOrder,
} from "./pipeline";

const settings = snapshot().settings;
const NOW_ISO = NOW.toISOString();

function atStage(stageId: string, overrides: Partial<Person> = {}): Person {
  const base = visitor();
  return visitor({ ...overrides, visitor: { ...base.visitor!, stageId } });
}

function withStages(stages: PipelineStage[]) {
  return { ...settings, pipelineStages: stages };
}

describe("stage lookups", () => {
  it("orders stages by their order field", () => {
    const shuffled = withStages([...settings.pipelineStages].reverse());
    expect(orderedStages(shuffled).map((stage) => stage.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("finds a stage and its order, with 0 for an unknown one", () => {
    expect(findStage(settings, "contacted")?.name).toBe("Contacted");
    expect(findStage(settings, "nope")).toBeUndefined();
    expect(stageOrder(settings, "returned")).toBe(6);
    expect(stageOrder(settings, "nope")).toBe(0);
  });

  it.each([
    ["connected", true],
    ["closed", true],
    ["contacted", false],
    ["nope", false],
  ])("isTerminalStage(%s) is %s", (stageId, expected) => {
    expect(isTerminalStage(settings, stageId)).toBe(expected);
  });
});

describe("closureStage", () => {
  it("prefers the conventional closed stage", () => {
    expect(closureStage(settings)?.id).toBe("closed");
  });

  it("falls back to the last terminal stage when 'closed' was removed", () => {
    const custom = withStages(settings.pipelineStages.filter((stage) => stage.id !== "closed"));
    expect(closureStage(custom)?.id).toBe("connected");
  });

  it("is undefined when there are no terminal stages", () => {
    const custom = withStages(settings.pipelineStages.filter((stage) => stage.kind !== "terminal"));
    expect(closureStage(custom)).toBeUndefined();
  });
});

describe("advanceStage", () => {
  it.each([
    ["moves forward", "new_visitor", "contacted", "contacted"],
    ["never moves backwards", "returned", "contacted", null],
    ["ignores the current stage", "contacted", "contacted", null],
    ["never leaves a terminal stage", "closed", "membership_orientation", null],
    ["ignores an unknown target", "new_visitor", "nope", null],
  ])("%s", (_label, from, to, expected) => {
    expect(advanceStage(settings, atStage(from), to)).toBe(expected);
  });

  it("returns null for a person without a visitor profile", () => {
    expect(advanceStage(settings, member(), "contacted")).toBeNull();
  });
});

describe("setStage", () => {
  it("moves the visitor, stamps the time and records an event", () => {
    const data = snapshot({ people: [visitor()] });
    const outcome = unwrap(setStage(data, "person_visitor", "contacted", ctx()));

    const person = outcome.snapshot.people[0];
    expect(person.visitor?.stageId).toBe("contacted");
    expect(person.visitor?.stageUpdatedAt).toBe(NOW_ISO);
    expect(person.updatedAt).toBe(NOW_ISO);
    expect(outcome.events).toEqual([
      { type: "visitor.stage_changed", personId: "person_visitor", stageId: "contacted" },
    ]);
    // The words on the board column, not the stage's internal name.
    expect(outcome.notices).toEqual(["Tunde Balogun moved to Spoken to."]);
    expect(outcome.snapshot.activity[0].summary).toBe('Tunde Balogun moved to "Spoken to".');
    expect(data.people[0].visitor?.stageId).toBe("new_visitor");
  });

  it("allows moving backwards when done by hand", () => {
    const data = snapshot({ people: [atStage("returned")] });
    expect(unwrap(setStage(data, "person_visitor", "contacted", ctx())).snapshot.people[0].visitor?.stageId).toBe(
      "contacted",
    );
  });

  it.each([
    ["an unknown person", snapshot({ people: [visitor()] }), "nobody", "contacted", "not_found"],
    ["a member without a visitor profile", snapshot({ people: [member()] }), "person_member", "contacted", "not_visitor"],
    ["an unknown stage", snapshot({ people: [visitor()] }), "person_visitor", "gone", "not_found"],
    ["the current stage", snapshot({ people: [visitor()] }), "person_visitor", "new_visitor", "unchanged"],
  ])("refuses %s", (_label, data, personId, stageId, code) => {
    const outcome = setStage(data, personId, stageId, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });
});

describe("assignVisitor", () => {
  const data = () =>
    snapshot({
      people: [visitor()],
      tasks: [
        task({ id: "t_open", assigneeId: undefined }),
        task({ id: "t_pastoral", type: "pastoral_contact", assigneeId: TEAM_IDS.careLead }),
        task({ id: "t_done", status: "completed", assigneeId: TEAM_IDS.coordinator }),
        task({ id: "t_other", personId: "someone_else", assigneeId: undefined }),
      ],
    });

  it("assigns, moves open tasks with it and promotes a new visitor", () => {
    const input = data();
    const outcome = unwrap(assignVisitor(input, "person_visitor", TEAM_IDS.volunteerAmara, ctx()));

    const person = outcome.snapshot.people[0];
    expect(person.visitor?.assignedTo).toBe(TEAM_IDS.volunteerAmara);
    expect(person.visitor?.stageId).toBe("contact_pending");
    expect(person.visitor?.stageUpdatedAt).toBe(NOW_ISO);

    const assignees = Object.fromEntries(outcome.snapshot.tasks.map((entry) => [entry.id, entry.assigneeId]));
    expect(assignees).toEqual({
      t_open: TEAM_IDS.volunteerAmara,
      t_pastoral: TEAM_IDS.careLead,
      t_done: TEAM_IDS.coordinator,
      t_other: undefined,
    });
    expect(outcome.notices).toEqual(["Tunde Balogun assigned to Amara Nwosu."]);
    expect(outcome.snapshot.activity[0].summary).toBe("Tunde Balogun assigned to Amara Nwosu for follow-up.");
    expect(input.tasks[0].assigneeId).toBeUndefined();
  });

  it("does not move a visitor who is already further along", () => {
    const input = snapshot({ people: [atStage("returned")] });
    const outcome = unwrap(assignVisitor(input, "person_visitor", TEAM_IDS.coordinator, ctx()));
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("returned");
  });

  it("unassigns without promoting", () => {
    const input = snapshot({
      people: [visitor({ visitor: { ...visitor().visitor!, assignedTo: TEAM_IDS.coordinator } })],
    });
    const outcome = unwrap(assignVisitor(input, "person_visitor", undefined, ctx()));
    expect(outcome.snapshot.people[0].visitor?.assignedTo).toBeUndefined();
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("new_visitor");
    expect(outcome.notices).toEqual(["Tunde Balogun unassigned."]);
    expect(outcome.snapshot.activity[0].summary).toBe("Tunde Balogun is no longer assigned to anyone.");
  });

  it.each([
    ["an unknown visitor", "nobody", TEAM_IDS.coordinator, "not_found"],
    ["an unknown team member", "person_visitor", "tm_ghost", "not_found"],
    ["an inactive volunteer", "person_visitor", TEAM_IDS.volunteerEsther, "inactive"],
  ])("refuses %s", (_label, personId, assigneeId, code) => {
    const outcome = assignVisitor(data(), personId, assigneeId, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });

  it("refuses a member with no visitor profile", () => {
    const outcome = assignVisitor(snapshot({ people: [member()] }), "person_member", TEAM_IDS.coordinator, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("closeFollowUp", () => {
  const data = () =>
    snapshot({
      people: [visitor()],
      tasks: [
        task({ id: "t_pending", notes: "Call after work" }),
        task({ id: "t_progress", status: "in_progress" }),
        task({ id: "t_done", status: "completed" }),
      ],
    });

  it("closes the record, cancels open tasks and keeps their notes", () => {
    const input = data();
    const outcome = unwrap(closeFollowUp(input, { personId: "person_visitor", reason: "no_response" }, ctx()));

    const person = outcome.snapshot.people[0];
    expect(person.visitor?.stageId).toBe("closed");
    expect(person.visitor?.closure).toEqual({ reason: "no_response", note: undefined, recordedAt: NOW_ISO });
    expect(person.contact.optedOut).toBe(false);

    const tasks = Object.fromEntries(outcome.snapshot.tasks.map((entry) => [entry.id, [entry.status, entry.notes]]));
    expect(tasks).toEqual({
      t_pending: ["cancelled", "Call after work\nCancelled: No response after agreed attempts."],
      t_progress: ["cancelled", "Cancelled: No response after agreed attempts."],
      t_done: ["completed", undefined],
    });
    expect(outcome.events).toEqual([{ type: "visitor.follow_up_stopped", personId: "person_visitor" }]);
    expect(outcome.notices).toEqual(["Follow-up stopped for Tunde Balogun.", "2 open tasks cancelled."]);
    expect(outcome.snapshot.activity).toHaveLength(1);
    expect(outcome.snapshot.activity[0].summary).toBe(
      "Follow-up for Tunde Balogun stopped — no response after agreed attempts.",
    );
    expect(input.tasks[0].status).toBe("pending");
  });

  it("records an opt-out when asked to", () => {
    const outcome = unwrap(
      closeFollowUp(
        snapshot({ people: [visitor()], tasks: [task()] }),
        { personId: "person_visitor", reason: "contact_declined", note: "Asked us to stop", optOut: true },
        ctx(),
      ),
    );
    const contact = outcome.snapshot.people[0].contact;
    expect(contact).toMatchObject({
      optedOut: true,
      permissionGranted: false,
      optedOutAt: NOW_ISO,
      optOutReason: "Asked us to stop",
    });
    expect(outcome.snapshot.activity.map((entry) => entry.type)).toEqual([
      "visitor.closed",
      "visitor.contact_preference_changed",
    ]);
    expect(outcome.notices).toEqual(["Follow-up stopped for Tunde Balogun.", "1 open task cancelled."]);
  });

  it("does not mention tasks when there were none open", () => {
    const outcome = unwrap(
      closeFollowUp(snapshot({ people: [visitor()] }), { personId: "person_visitor", reason: "paused" }, ctx()),
    );
    expect(outcome.notices).toEqual(["Follow-up stopped for Tunde Balogun."]);
  });

  it("keeps the current stage when the church has no terminal stage", () => {
    const base = snapshot({ people: [atStage("contacted")] });
    const custom = {
      ...base,
      settings: withStages(settings.pipelineStages.filter((stage) => stage.kind !== "terminal")),
    };
    const outcome = unwrap(closeFollowUp(custom, { personId: "person_visitor", reason: "referred" }, ctx()));
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("contacted");
    expect(outcome.snapshot.people[0].visitor?.closure?.reason).toBe("referred");
  });

  it("refuses someone without a visitor record", () => {
    const outcome = closeFollowUp(snapshot({ people: [member()] }), { personId: "person_member", reason: "closed" }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("setContactPreferences", () => {
  const data = () =>
    snapshot({
      people: [visitor()],
      tasks: [
        task({ id: "t_welcome" }),
        task({ id: "t_call", type: "phone_call", status: "rescheduled", notes: "Evenings" }),
        task({ id: "t_pastoral", type: "pastoral_contact" }),
      ],
    });

  it("opting out cancels contact tasks but keeps pastoral ones", () => {
    const input = data();
    const outcome = unwrap(
      setContactPreferences(input, { personId: "person_visitor", optedOut: true, optOutReason: "Moved away" }, ctx()),
    );

    expect(outcome.snapshot.people[0].contact).toEqual({
      preferredMethod: "whatsapp",
      permissionGranted: false,
      optedOut: true,
      optedOutAt: NOW_ISO,
      optOutReason: "Moved away",
    });
    const tasks = Object.fromEntries(outcome.snapshot.tasks.map((entry) => [entry.id, [entry.status, entry.notes]]));
    expect(tasks).toEqual({
      t_welcome: ["cancelled", "Cancelled: the person opted out of contact."],
      t_call: ["cancelled", "Evenings\nCancelled: the person opted out of contact."],
      t_pastoral: ["pending", undefined],
    });
    expect(outcome.events).toEqual([{ type: "visitor.follow_up_stopped", personId: "person_visitor" }]);
    expect(outcome.notices).toEqual(["Contact preferences updated.", "2 open follow-up tasks cancelled."]);
    expect(outcome.snapshot.activity[0].summary).toBe("Tunde Balogun opted out of contact.");
    expect(input.people[0].contact.optedOut).toBe(false);
  });

  it("reports a single cancelled task in the singular and none when nothing was open", () => {
    const one = unwrap(
      setContactPreferences(snapshot({ people: [visitor()], tasks: [task()] }), { personId: "person_visitor", optedOut: true }, ctx()),
    );
    expect(one.notices).toEqual(["Contact preferences updated.", "1 open follow-up task cancelled."]);

    const none = unwrap(
      setContactPreferences(snapshot({ people: [visitor()] }), { personId: "person_visitor", optedOut: true }, ctx()),
    );
    expect(none.notices).toEqual(["Contact preferences updated."]);
    expect(none.events).toHaveLength(1);
  });

  it("changes the preferred method without touching tasks", () => {
    const outcome = unwrap(
      setContactPreferences(data(), { personId: "person_visitor", preferredMethod: "email", permissionGranted: false }, ctx()),
    );
    expect(outcome.snapshot.people[0].contact).toEqual({
      preferredMethod: "email",
      permissionGranted: false,
      optedOut: false,
      optedOutAt: undefined,
      optOutReason: undefined,
    });
    expect(outcome.snapshot.tasks.every((entry) => entry.status !== "cancelled")).toBe(true);
    expect(outcome.events).toEqual([]);
    expect(outcome.snapshot.activity[0].summary).toBe("Contact preferences updated for Tunde Balogun.");
  });

  it("keeps the original opt-out time and reason when already opted out", () => {
    const optedOut = visitor({
      contact: {
        preferredMethod: "phone",
        permissionGranted: false,
        optedOut: true,
        optedOutAt: "2026-09-01T10:00:00.000Z",
        optOutReason: "Original reason",
      },
    });
    const outcome = unwrap(
      setContactPreferences(snapshot({ people: [optedOut], tasks: [task()] }), { personId: "person_visitor", permissionGranted: true }, ctx()),
    );
    expect(outcome.snapshot.people[0].contact).toMatchObject({
      permissionGranted: false,
      optedOut: true,
      optedOutAt: "2026-09-01T10:00:00.000Z",
      optOutReason: "Original reason",
    });
    expect(outcome.snapshot.tasks[0].status).toBe("pending");
    expect(outcome.events).toEqual([]);
  });

  it("opting back in clears the opt-out details", () => {
    const optedOut = visitor({
      contact: { preferredMethod: "phone", permissionGranted: false, optedOut: true, optedOutAt: NOW_ISO, optOutReason: "x" },
    });
    const outcome = unwrap(
      setContactPreferences(snapshot({ people: [optedOut] }), { personId: "person_visitor", optedOut: false, permissionGranted: true }, ctx()),
    );
    expect(outcome.snapshot.people[0].contact).toEqual({
      preferredMethod: "phone",
      permissionGranted: true,
      optedOut: false,
      optedOutAt: undefined,
      optOutReason: undefined,
    });
  });

  it("refuses an unknown person", () => {
    const outcome = setContactPreferences(snapshot(), { personId: "nobody", optedOut: true }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("audit fixes: stopping, reopening and assigning", () => {
  const closedVisitor = (overrides: Partial<NonNullable<Person["visitor"]>> = {}) =>
    visitor({
      visitor: {
        ...visitor().visitor!,
        stageId: "closed",
        closure: { reason: "paused", recordedAt: NOW_ISO },
        ...overrides,
      },
    });

  it("refuses a plain move into the stopped stage, so open tasks can't be left running", () => {
    const data = snapshot({ people: [visitor()], tasks: [task()] });
    const outcome = setStage(data, "person_visitor", "closed", ctx());
    expect(outcome).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses to move a stopped visitor without reopening first", () => {
    const outcome = setStage(snapshot({ people: [closedVisitor()] }), "person_visitor", "contacted", ctx());
    expect(outcome).toMatchObject({ ok: false, code: "closed" });
  });

  it("reopens a stopped visitor: clears the closure, picks an active stage and logs it", () => {
    const data = snapshot({ people: [closedVisitor({ assignedTo: TEAM_IDS.coordinator })] });
    const outcome = unwrap(reopenFollowUp(data, { personId: "person_visitor" }, ctx()));
    const profile = outcome.snapshot.people[0].visitor!;
    expect(profile.closure).toBeUndefined();
    expect(profile.stageId).toBe("contact_pending");
    expect(outcome.snapshot.activity[0]).toMatchObject({ type: "visitor.reopened" });
    expect(outcome.notices).toEqual(["Follow-up for Tunde Balogun reopened. Decide the next step."]);
  });

  it("reopens a visitor moved into a final stage by mistake, into the stage asked for", () => {
    const data = snapshot({ people: [atStage("connected")] });
    const outcome = unwrap(reopenFollowUp(data, { personId: "person_visitor", stageId: "contacted" }, ctx()));
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("contacted");
  });

  it.each([
    ["somebody whose follow-up is open", snapshot({ people: [visitor()] }), {}, "unchanged"],
    ["a final stage as the target", snapshot({ people: [closedVisitor()] }), { stageId: "connected" }, "invalid"],
    [
      "somebody who opted out",
      snapshot({ people: [{ ...closedVisitor(), contact: { preferredMethod: "sms" as const, permissionGranted: false, optedOut: true } }] }),
      {},
      "opted_out",
    ],
  ])("refuses to reopen %s", (_label, data, extra, code) => {
    expect(reopenFollowUp(data, { personId: "person_visitor", ...extra }, ctx())).toMatchObject({ ok: false, code });
  });

  it.each([
    [
      "somebody who opted out",
      visitor({ contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true } }),
      TEAM_IDS.coordinator,
      "opted_out",
    ],
    ["somebody whose follow-up stopped", closedVisitor(), TEAM_IDS.coordinator, "closed"],
    [
      "the person already looking after them",
      visitor({ visitor: { ...visitor().visitor!, assignedTo: TEAM_IDS.coordinator } }),
      TEAM_IDS.coordinator,
      "unchanged",
    ],
  ])("refuses to assign %s", (_label, person, assigneeId, code) => {
    expect(assignVisitor(snapshot({ people: [person] }), "person_visitor", assigneeId, ctx())).toMatchObject({
      ok: false,
      code,
    });
  });
});
