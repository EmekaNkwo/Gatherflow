import { err, ok, type Result } from "@/lib/result";
import type { PipelineStage } from "@/types/follow-up";
import type {
  AutomationRuleConfig,
  AutomationRuleId,
  ChurchSettings,
  EngagementCriteria,
  ServiceDefinition,
} from "@/types/settings";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { patch } from "../core/snapshot";

export function updateChurchProfile(
  snapshot: ChurchSnapshot,
  changes: { churchName?: string; timezoneLabel?: string; defaultFollowUpDueInDays?: number },
): Result<CommandResult> {
  const churchName = changes.churchName?.trim();
  if (changes.churchName !== undefined && !churchName) {
    return err("The church needs a name.", "invalid");
  }
  if (
    changes.defaultFollowUpDueInDays !== undefined &&
    (changes.defaultFollowUpDueInDays < 0 || changes.defaultFollowUpDueInDays > 90)
  ) {
    return err("Follow-up windows must be between 0 and 90 days.", "invalid");
  }

  const settings: ChurchSettings = {
    ...snapshot.settings,
    churchName: churchName ?? snapshot.settings.churchName,
    timezoneLabel: changes.timezoneLabel ?? snapshot.settings.timezoneLabel,
    defaultFollowUpDueInDays:
      changes.defaultFollowUpDueInDays ?? snapshot.settings.defaultFollowUpDueInDays,
  };

  return ok(result(patch(snapshot, { settings }), [], ["Settings saved."]));
}

export function updateAutomationRule(
  snapshot: ChurchSnapshot,
  id: AutomationRuleId,
  changes: Partial<Omit<AutomationRuleConfig, "id">>,
): Result<CommandResult> {
  const rule = snapshot.settings.automationRules.find((entry) => entry.id === id);
  if (!rule) return err("That rule is not available in this build.", "not_found");

  if (changes.dueInDays !== undefined && (changes.dueInDays < 0 || changes.dueInDays > 90)) {
    return err("Due windows must be between 0 and 90 days.", "invalid");
  }

  const settings: ChurchSettings = {
    ...snapshot.settings,
    automationRules: snapshot.settings.automationRules.map((entry) =>
      entry.id === id ? { ...entry, ...changes } : entry,
    ),
  };

  return ok(result(patch(snapshot, { settings }), [], ["Automation rule updated."]));
}

export function updateEngagementCriteria(
  snapshot: ChurchSnapshot,
  changes: Partial<EngagementCriteria>,
): Result<CommandResult> {
  const engagement: EngagementCriteria = { ...snapshot.settings.engagement, ...changes };

  if (engagement.inactiveAfterWeeksAbsent < 1 || engagement.inactiveAfterWeeksAbsent > 52) {
    return err("The inactivity threshold must be between 1 and 52 weeks.", "invalid");
  }
  if (engagement.attendanceAverageWeeks < 1 || engagement.attendanceAverageWeeks > 52) {
    return err("The attendance window must be between 1 and 52 weeks.", "invalid");
  }
  if (engagement.maxContactAttempts < 1 || engagement.maxContactAttempts > 10) {
    return err("Contact attempts must be between 1 and 10.", "invalid");
  }

  return ok(
    result(
      patch(snapshot, { settings: { ...snapshot.settings, engagement } }),
      [],
      ["Engagement criteria saved. Reports will explain the new thresholds."],
    ),
  );
}

/**
 * Replaces the pipeline stages.
 *
 * Stages that still hold visitors cannot be removed: the records would lose
 * their place in the pipeline. The UI offers to move them first.
 */
export function updatePipelineStages(
  snapshot: ChurchSnapshot,
  stages: readonly PipelineStage[],
): Result<CommandResult> {
  if (!stages.length) return err("Keep at least one stage.", "invalid");

  const ids = new Set(stages.map((stage) => stage.id));
  const inUse = snapshot.people.filter(
    (person) => person.visitor && !ids.has(person.visitor.stageId),
  );
  if (inUse.length) {
    return err(
      `${inUse.length} visitor record${inUse.length === 1 ? " is" : "s are"} still in a stage you removed. Move them first.`,
      "in_use",
    );
  }

  const ordered = stages.map((stage, index) => ({ ...stage, order: index + 1 }));

  return ok(
    result(
      patch(snapshot, { settings: { ...snapshot.settings, pipelineStages: ordered } }),
      [],
      ["Pipeline stages saved."],
    ),
  );
}

export function updateServices(
  snapshot: ChurchSnapshot,
  services: readonly ServiceDefinition[],
): Result<CommandResult> {
  if (!services.length) return err("Keep at least one service.", "invalid");
  return ok(
    result(
      patch(snapshot, { settings: { ...snapshot.settings, services } }),
      [],
      ["Services saved."],
    ),
  );
}

/** Adds or updates a team member. */
export function upsertTeamMember(
  snapshot: ChurchSnapshot,
  input: { id?: string; name: string; role: ChurchSnapshot["team"][number]["role"]; title?: string; active?: boolean },
  ctx: CommandContext,
): Result<CommandResult> {
  const name = input.name.trim();
  if (!name) return err("A name is required.", "invalid");

  if (input.id) {
    const existing = snapshot.team.find((member) => member.id === input.id);
    if (!existing) return err("That team member no longer exists.", "not_found");
    return ok(
      result(
        patch(snapshot, {
          team: snapshot.team.map((member) =>
            member.id === input.id
              ? {
                  ...member,
                  name,
                  role: input.role,
                  title: input.title?.trim() || undefined,
                  active: input.active ?? member.active,
                }
              : member,
          ),
        }),
        [],
        [`${name} updated.`],
      ),
    );
  }

  return ok(
    result(
      patch(snapshot, {
        team: [
          ...snapshot.team,
          {
            id: ctx.id("tm"),
            name,
            role: input.role,
            title: input.title?.trim() || undefined,
            active: input.active ?? true,
            createdAt: ctx.nowIso,
          },
        ],
      }),
      [],
      [`${name} added to the team.`],
    ),
  );
}

/**
 * Deactivating a volunteer leaves their completed history alone but stops
 * new work being assigned to them. Open tasks are reported so a coordinator
 * can redistribute them.
 */
export function setTeamMemberActive(
  snapshot: ChurchSnapshot,
  teamMemberId: string,
  active: boolean,
): Result<CommandResult> {
  const member = snapshot.team.find((entry) => entry.id === teamMemberId);
  if (!member) return err("That team member no longer exists.", "not_found");

  const open = snapshot.tasks.filter(
    (task) =>
      task.assigneeId === teamMemberId &&
      ["pending", "in_progress", "rescheduled"].includes(task.status),
  );

  return ok(
    result(
      patch(snapshot, {
        team: snapshot.team.map((entry) =>
          entry.id === teamMemberId ? { ...entry, active } : entry,
        ),
      }),
      [],
      [
        `${member.name} marked as ${active ? "active" : "inactive"}.`,
        ...(!active && open.length
          ? [`${open.length} open task${open.length === 1 ? "" : "s"} still assigned — reassign them.`]
          : []),
      ],
    ),
  );
}
