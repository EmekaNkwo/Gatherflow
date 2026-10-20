import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap, type Result } from "@/lib/result";
import { ctx, NOW, snapshot, task, visitor } from "@/tests/factories";
import type { Person } from "@/types/person";
import type { CommandResult } from "../core/events";
import {
  reassignOpenTasks,
  setTeamMemberActive,
  updateAutomationRule,
  updateChurchProfile,
  updateEngagementCriteria,
  updatePipelineStages,
  updateServices,
  upsertTeamMember,
} from "./settings";

function refusal(outcome: Result<CommandResult>): { code?: string; error: string } | undefined {
  return outcome.ok ? undefined : { code: outcome.code, error: outcome.error };
}

describe("updateChurchProfile", () => {
  it("saves trimmed changes and keeps everything else", () => {
    const input = snapshot();
    const outcome = unwrap(
      updateChurchProfile(input, { churchName: "  Riverside Chapel ", defaultFollowUpDueInDays: 0 }),
    );
    expect(outcome.snapshot.settings).toMatchObject({
      churchName: "Riverside Chapel",
      timezoneLabel: "Local church time",
      defaultFollowUpDueInDays: 0,
    });
    expect(outcome.snapshot.settings.pipelineStages).toBe(input.settings.pipelineStages);
    expect(outcome.notices).toEqual(["Settings saved."]);
    expect(input.settings.churchName).toBe("Grace Community Church");
  });

  it("changes only the timezone label when that is all that was given", () => {
    const outcome = unwrap(updateChurchProfile(snapshot(), { timezoneLabel: "Lagos (WAT)" }));
    expect(outcome.snapshot.settings.churchName).toBe("Grace Community Church");
    expect(outcome.snapshot.settings.timezoneLabel).toBe("Lagos (WAT)");
    expect(outcome.snapshot.settings.defaultFollowUpDueInDays).toBe(3);
  });

  it.each([
    [{ churchName: "   " }, "The church needs a name."],
    [{ defaultFollowUpDueInDays: -1 }, "Follow-up windows must be between 0 and 90 days."],
    [{ defaultFollowUpDueInDays: 91 }, "Follow-up windows must be between 0 and 90 days."],
  ])("refuses %j", (changes, error) => {
    expect(refusal(updateChurchProfile(snapshot(), changes))).toEqual({ code: "invalid", error });
  });

  it("accepts the 90-day upper bound", () => {
    expect(unwrap(updateChurchProfile(snapshot(), { defaultFollowUpDueInDays: 90 })).snapshot.settings.defaultFollowUpDueInDays).toBe(90);
  });
});

describe("updateAutomationRule", () => {
  it("updates one rule and leaves the rest", () => {
    const input = snapshot();
    const outcome = unwrap(updateAutomationRule(input, "overdue_alert", { enabled: false, dueInDays: 1 }));
    const rules = outcome.snapshot.settings.automationRules;
    expect(rules.find((rule) => rule.id === "overdue_alert")).toEqual({ id: "overdue_alert", enabled: false, dueInDays: 1 });
    expect(rules.find((rule) => rule.id === "first_visit_welcome")).toBe(
      input.settings.automationRules.find((rule) => rule.id === "first_visit_welcome"),
    );
    expect(input.settings.automationRules.find((rule) => rule.id === "overdue_alert")?.enabled).toBe(true);
    expect(outcome.notices).toEqual(["Automation rule updated."]);
  });

  it("refuses a rule that is not configured", () => {
    const base = snapshot();
    const without = snapshot({ settings: { ...base.settings, automationRules: [] } });
    expect(refusal(updateAutomationRule(without, "overdue_alert", { enabled: false }))?.code).toBe("not_found");
  });

  it.each([-1, 91])("refuses a due window of %i days", (dueInDays) => {
    expect(refusal(updateAutomationRule(snapshot(), "overdue_alert", { dueInDays }))).toEqual({
      code: "invalid",
      error: "Due windows must be between 0 and 90 days.",
    });
  });
});

describe("updateEngagementCriteria", () => {
  it("merges the changes", () => {
    const outcome = unwrap(updateEngagementCriteria(snapshot(), { inactiveAfterWeeksAbsent: 12 }));
    expect(outcome.snapshot.settings.engagement).toEqual({
      inactiveAfterWeeksAbsent: 12,
      attendanceAverageWeeks: 6,
      maxContactAttempts: 3,
    });
    expect(outcome.notices).toEqual(["Engagement criteria saved. Reports will explain the new thresholds."]);
  });

  it.each([
    [{ inactiveAfterWeeksAbsent: 0 }, "The inactivity threshold must be between 1 and 52 weeks."],
    [{ inactiveAfterWeeksAbsent: 53 }, "The inactivity threshold must be between 1 and 52 weeks."],
    [{ attendanceAverageWeeks: 0 }, "The attendance window must be between 1 and 52 weeks."],
    [{ attendanceAverageWeeks: 53 }, "The attendance window must be between 1 and 52 weeks."],
    [{ maxContactAttempts: 0 }, "Contact attempts must be between 1 and 10."],
    [{ maxContactAttempts: 11 }, "Contact attempts must be between 1 and 10."],
  ])("refuses %j", (changes, error) => {
    expect(refusal(updateEngagementCriteria(snapshot(), changes))).toEqual({ code: "invalid", error });
  });

  it.each([
    [{ inactiveAfterWeeksAbsent: 1, attendanceAverageWeeks: 52, maxContactAttempts: 10 }],
    [{ inactiveAfterWeeksAbsent: 52, attendanceAverageWeeks: 1, maxContactAttempts: 1 }],
  ])("accepts the bounds %j", (changes) => {
    expect(unwrap(updateEngagementCriteria(snapshot(), changes)).snapshot.settings.engagement).toEqual(changes);
  });
});

describe("updatePipelineStages", () => {
  const stages = snapshot().settings.pipelineStages;
  const atStage = (id: string, stageId: string): Person => visitor({ id, visitor: { ...visitor().visitor!, stageId } });

  it("renumbers stages in the order given", () => {
    const reordered = [stages[1], stages[0], ...stages.slice(2)];
    const outcome = unwrap(updatePipelineStages(snapshot({ people: [visitor()] }), reordered));
    const saved = outcome.snapshot.settings.pipelineStages;
    expect(saved.slice(0, 2).map((stage) => [stage.id, stage.order])).toEqual([
      ["contact_pending", 1],
      ["new_visitor", 2],
    ]);
    expect(saved.map((stage) => stage.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stages[0].order).toBe(1);
    expect(outcome.notices).toEqual(["Pipeline stages saved."]);
  });

  it("allows removing an empty stage", () => {
    const outcome = updatePipelineStages(
      snapshot({ people: [visitor()] }),
      stages.filter((stage) => stage.id !== "contact_attempted"),
    );
    expect(outcome.ok).toBe(true);
  });

  it("refuses an empty list", () => {
    expect(refusal(updatePipelineStages(snapshot(), []))).toEqual({ code: "invalid", error: "Keep at least one stage." });
  });

  it.each([
    [[atStage("a", "contacted")], "1 visitor record is still in a stage you removed. Move them first."],
    [
      [atStage("a", "contacted"), atStage("b", "contacted")],
      "2 visitor records are still in a stage you removed. Move them first.",
    ],
  ])("refuses to remove a stage that still holds visitors", (people, error) => {
    const outcome = updatePipelineStages(snapshot({ people }), stages.filter((stage) => stage.id !== "contacted"));
    expect(refusal(outcome)).toEqual({ code: "in_use", error });
  });
});

describe("updateServices", () => {
  it("replaces the service list", () => {
    const [first] = snapshot().settings.services;
    const outcome = unwrap(updateServices(snapshot(), [{ ...first, time: "11:00" }]));
    expect(outcome.snapshot.settings.services).toEqual([{ ...first, time: "11:00" }]);
    expect(outcome.notices).toEqual(["Services saved."]);
  });

  it("refuses an empty list", () => {
    expect(refusal(updateServices(snapshot(), []))?.code).toBe("invalid");
  });
});

describe("upsertTeamMember", () => {
  it("adds a new, active team member", () => {
    const input = snapshot();
    const outcome = unwrap(upsertTeamMember(input, { name: " Sola Ade ", role: "volunteer", title: "  " }, ctx()));
    const added = outcome.snapshot.team.at(-1);
    expect(added).toEqual({
      id: "tm_1",
      name: "Sola Ade",
      role: "volunteer",
      title: undefined,
      active: true,
      createdAt: NOW.toISOString(),
    });
    expect(outcome.notices).toEqual(["Sola Ade added to the team."]);
    expect(input.team).toHaveLength(5);
  });

  it("can add someone as inactive with a title", () => {
    const outcome = unwrap(
      upsertTeamMember(snapshot(), { name: "Sola", role: "volunteer", title: " Usher ", active: false }, ctx()),
    );
    expect(outcome.snapshot.team.at(-1)).toMatchObject({ title: "Usher", active: false });
  });

  it("updates an existing member and keeps their active flag by default", () => {
    const outcome = unwrap(
      upsertTeamMember(snapshot(), { id: TEAM_IDS.volunteerEsther, name: "Esther B.", role: "follow_up_coordinator", title: "Lead" }, ctx()),
    );
    const updated = outcome.snapshot.team.find((entry) => entry.id === TEAM_IDS.volunteerEsther);
    expect(updated).toMatchObject({ name: "Esther B.", role: "follow_up_coordinator", title: "Lead", active: false });
    expect(outcome.snapshot.team).toHaveLength(5);
    expect(outcome.notices).toEqual(["Esther B. updated."]);
  });

  it("can reactivate an existing member", () => {
    const outcome = unwrap(
      upsertTeamMember(snapshot(), { id: TEAM_IDS.volunteerEsther, name: "Esther Bello", role: "volunteer", active: true }, ctx()),
    );
    expect(outcome.snapshot.team.find((entry) => entry.id === TEAM_IDS.volunteerEsther)?.active).toBe(true);
  });

  it.each([
    [{ name: "  ", role: "volunteer" as const }, "invalid"],
    [{ id: "tm_ghost", name: "Ghost", role: "volunteer" as const }, "not_found"],
  ])("refuses %j", (input, code) => {
    expect(refusal(upsertTeamMember(snapshot(), input, ctx()))?.code).toBe(code);
  });
});

describe("setTeamMemberActive", () => {
  const withTasks = () =>
    snapshot({
      tasks: [
        task({ id: "t1", assigneeId: TEAM_IDS.volunteerAmara }),
        task({ id: "t2", assigneeId: TEAM_IDS.volunteerAmara, status: "rescheduled" }),
        task({ id: "t3", assigneeId: TEAM_IDS.volunteerAmara, status: "completed" }),
        task({ id: "t4", assigneeId: TEAM_IDS.coordinator }),
      ],
    });

  it("deactivates and reports open work to redistribute", () => {
    const input = withTasks();
    const outcome = unwrap(setTeamMemberActive(input, TEAM_IDS.volunteerAmara, false));
    expect(outcome.snapshot.team.find((entry) => entry.id === TEAM_IDS.volunteerAmara)?.active).toBe(false);
    expect(outcome.notices).toEqual([
      "Amara Nwosu marked as inactive.",
      "2 open follow-ups are still with them. Move them to someone else.",
    ]);
    expect(outcome.openTasks).toBe(2);
    expect(outcome.snapshot.tasks).toBe(input.tasks);
    expect(input.team.find((entry) => entry.id === TEAM_IDS.volunteerAmara)?.active).toBe(true);
  });

  it("uses the singular for one open task", () => {
    const outcome = unwrap(setTeamMemberActive(withTasks(), TEAM_IDS.coordinator, false));
    expect(outcome.notices).toEqual([
      "Grace Mensah marked as inactive.",
      "1 open follow-up is still with them. Move them to someone else.",
    ]);
  });

  it("says nothing about tasks when activating", () => {
    const outcome = unwrap(setTeamMemberActive(withTasks(), TEAM_IDS.volunteerAmara, true));
    expect(outcome.notices).toEqual(["Amara Nwosu marked as active."]);
  });

  it("refuses an unknown team member", () => {
    expect(refusal(setTeamMemberActive(snapshot(), "tm_ghost", true))?.code).toBe("not_found");
  });

  it("won't let anyone switch themselves off", () => {
    expect(refusal(setTeamMemberActive(snapshot(), TEAM_IDS.coordinator, false, ctx()))).toEqual({
      code: "forbidden",
      error: "You can't switch yourself off. Ask another administrator.",
    });
  });
});

describe("reassignOpenTasks", () => {
  const withTasks = () =>
    snapshot({
      tasks: [
        task({ id: "t1", assigneeId: TEAM_IDS.volunteerAmara }),
        task({ id: "t2", assigneeId: TEAM_IDS.volunteerAmara, status: "in_progress", type: "pastoral_contact" }),
        task({ id: "t3", assigneeId: TEAM_IDS.volunteerAmara, status: "completed" }),
      ],
    });

  it("moves every open follow-up to an active team member and leaves finished ones alone", () => {
    const input = withTasks();
    const outcome = unwrap(
      reassignOpenTasks(input, { fromTeamMemberId: TEAM_IDS.volunteerAmara, toTeamMemberId: TEAM_IDS.coordinator }, ctx()),
    );
    expect(outcome.snapshot.tasks.map((entry) => [entry.id, entry.assigneeId])).toEqual([
      ["t1", TEAM_IDS.coordinator],
      ["t2", TEAM_IDS.coordinator],
      ["t3", TEAM_IDS.volunteerAmara],
    ]);
    expect(outcome.moved).toBe(2);
    expect(outcome.notices).toEqual(["2 open follow-ups moved to Grace Mensah."]);
    expect(outcome.snapshot.activity.map((entry) => entry.visibility)).toEqual(["general", "restricted"]);
    expect(input.tasks[0].assigneeId).toBe(TEAM_IDS.volunteerAmara);
  });

  it.each([
    [TEAM_IDS.volunteerEsther, "inactive"],
    [TEAM_IDS.volunteerAmara, "invalid"],
    ["tm_ghost", "not_found"],
  ])("refuses to give them to %s", (toTeamMemberId, code) => {
    expect(
      refusal(reassignOpenTasks(withTasks(), { fromTeamMemberId: TEAM_IDS.volunteerAmara, toTeamMemberId }, ctx()))?.code,
    ).toBe(code);
  });

  it("says so when there is nothing to move", () => {
    expect(
      refusal(reassignOpenTasks(snapshot(), { fromTeamMemberId: TEAM_IDS.volunteerAmara, toTeamMemberId: TEAM_IDS.coordinator }, ctx()))
        ?.code,
    ).toBe("unchanged");
  });
});

describe("rule assignees (H4/H5)", () => {
  it("clears the assignee when given null", () => {
    const outcome = unwrap(updateAutomationRule(snapshot(), "first_visit_welcome", { defaultAssigneeId: null }));
    const rule = outcome.snapshot.settings.automationRules.find((entry) => entry.id === "first_visit_welcome");
    expect(rule).not.toHaveProperty("defaultAssigneeId");
    expect(rule?.enabled).toBe(true);
  });

  it("keeps the assignee when the field is left out", () => {
    const outcome = unwrap(updateAutomationRule(snapshot(), "first_visit_welcome", { dueInDays: 4 }));
    expect(outcome.snapshot.settings.automationRules.find((entry) => entry.id === "first_visit_welcome")?.defaultAssigneeId).toBe(
      TEAM_IDS.coordinator,
    );
  });

  it("refuses an inactive or unknown assignee", () => {
    expect(
      refusal(updateAutomationRule(snapshot(), "first_visit_welcome", { defaultAssigneeId: TEAM_IDS.volunteerEsther }))?.code,
    ).toBe("inactive");
    expect(refusal(updateAutomationRule(snapshot(), "first_visit_welcome", { defaultAssigneeId: "tm_ghost" }))?.code).toBe(
      "not_found",
    );
  });

  it("accepts an active team member", () => {
    const outcome = unwrap(
      updateAutomationRule(snapshot(), "first_visit_welcome", { defaultAssigneeId: TEAM_IDS.volunteerAmara }),
    );
    expect(outcome.snapshot.settings.automationRules.find((entry) => entry.id === "first_visit_welcome")?.defaultAssigneeId).toBe(
      TEAM_IDS.volunteerAmara,
    );
  });
});

describe("self-protection and services (LOW)", () => {
  it("won't let you change your own role or switch yourself off through the team list", () => {
    const self = { id: TEAM_IDS.coordinator, name: "Grace Mensah" };
    expect(refusal(upsertTeamMember(snapshot(), { ...self, role: "volunteer" }, ctx()))?.code).toBe("forbidden");
    expect(refusal(upsertTeamMember(snapshot(), { ...self, role: "follow_up_coordinator", active: false }, ctx()))?.code).toBe(
      "forbidden",
    );
    expect(upsertTeamMember(snapshot(), { ...self, role: "follow_up_coordinator", title: "Lead" }, ctx()).ok).toBe(true);
  });

  it("keeps at least one service running", () => {
    const services = snapshot().settings.services.map((service) => ({ ...service, active: false }));
    expect(refusal(updateServices(snapshot(), services))?.code).toBe("invalid");
  });
});

describe("country calling code", () => {
  it("stores the digits without a plus", () => {
    const outcome = unwrap(updateChurchProfile(snapshot(), { defaultCountryCallingCode: " +234 " }));
    expect(outcome.snapshot.settings.defaultCountryCallingCode).toBe("234");
  });

  it.each(["0", "1234", "abc", ""])("refuses %j", (defaultCountryCallingCode) => {
    expect(refusal(updateChurchProfile(snapshot(), { defaultCountryCallingCode }))?.code).toBe("invalid");
  });
});
