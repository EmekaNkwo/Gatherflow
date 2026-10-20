import { isCallingCode } from "@/lib/phone";
import { err, ok, type Result } from "@/lib/result";
import type { FollowUpTask, PipelineStage } from "@/types/follow-up";
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
import { activity, patch, withActivity } from "../core/snapshot";

/** Statuses that still need somebody; kept in step with follow-ups. */
const OPEN_STATUSES: readonly FollowUpTask["status"][] = ["pending", "in_progress", "rescheduled"];

/** Open follow-ups still sitting with a team member. */
export function openTasksFor(snapshot: Pick<ChurchSnapshot, "tasks">, teamMemberId: string): FollowUpTask[] {
  return snapshot.tasks.filter((task) => task.assigneeId === teamMemberId && OPEN_STATUSES.includes(task.status));
}

/** The team member with that id, if they are still on the team. */
function teamMember(snapshot: ChurchSnapshot, teamMemberId: string) {
  return snapshot.team.find((member) => member.id === teamMemberId);
}

export interface ProfileChanges {
  churchName?: string;
  timezoneLabel?: string;
  defaultFollowUpDueInDays?: number;
  /** Digits, with or without a leading `+`, e.g. "44" or "+234". */
  defaultCountryCallingCode?: string;
}

export function updateChurchProfile(
  snapshot: ChurchSnapshot,
  changes: ProfileChanges,
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
  const callingCode = changes.defaultCountryCallingCode?.trim().replace(/^\+/, "");
  if (callingCode !== undefined && !isCallingCode(callingCode)) {
    return err("The country calling code is one to three digits, such as 44 or 234.", "invalid");
  }

  const settings: ChurchSettings = {
    ...snapshot.settings,
    churchName: churchName ?? snapshot.settings.churchName,
    timezoneLabel: changes.timezoneLabel ?? snapshot.settings.timezoneLabel,
    defaultFollowUpDueInDays:
      changes.defaultFollowUpDueInDays ?? snapshot.settings.defaultFollowUpDueInDays,
    ...(callingCode !== undefined ? { defaultCountryCallingCode: callingCode } : {}),
  };

  return ok(result(patch(snapshot, { settings }), [], ["Settings saved."]));
}

export interface AutomationRuleChanges {
  enabled?: boolean;
  dueInDays?: number;
  /** A team member, or `null` to leave the rule's tasks unassigned. */
  defaultAssigneeId?: string | null;
}

/**
 * Changes one automation rule.
 *
 * `defaultAssigneeId: null` clears the assignee ("Nobody yet"); `undefined`
 * leaves it alone. A rule can only be given to somebody active on the team,
 * so new work never lands with a person who is away.
 */
export function updateAutomationRule(
  snapshot: ChurchSnapshot,
  id: AutomationRuleId,
  changes: AutomationRuleChanges,
): Result<CommandResult> {
  const rule = snapshot.settings.automationRules.find((entry) => entry.id === id);
  if (!rule) return err("That rule is not available in this build.", "not_found");

  if (changes.dueInDays !== undefined && (changes.dueInDays < 0 || changes.dueInDays > 90)) {
    return err("Due windows must be between 0 and 90 days.", "invalid");
  }
  if (changes.defaultAssigneeId) {
    const member = teamMember(snapshot, changes.defaultAssigneeId);
    if (!member) return err("That team member no longer exists.", "not_found");
    if (!member.active) {
      return err(`${member.name} is marked as inactive, so new tasks can't go to them.`, "inactive");
    }
    if (member.role === "member") {
      return err(`${member.name} isn't on the follow-up team, so tasks can't go to them.`, "invalid");
    }
  }

  const { defaultAssigneeId, ...rest } = changes;
  const settings: ChurchSettings = {
    ...snapshot.settings,
    automationRules: snapshot.settings.automationRules.map((entry) => {
      if (entry.id !== id) return entry;
      const updated: AutomationRuleConfig = { ...entry, ...rest };
      if (defaultAssigneeId === undefined) return updated;
      if (defaultAssigneeId === null) {
        // A fresh copy, so removing the key touches nothing shared.
        const unassigned = { ...updated };
        delete unassigned.defaultAssigneeId;
        return unassigned;
      }
      return { ...updated, defaultAssigneeId };
    }),
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
  if (!services.some((service) => service.active)) {
    return err("Keep at least one service running, or check-in has nothing to record against.", "invalid");
  }
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
    // Your own role is the one the server enforces on your account; changing
    // it, or switching yourself off, here would leave the two disagreeing.
    if (existing.id === ctx.actorId && (input.role !== existing.role || input.active === false)) {
      return err("You can't change your own role or switch yourself off. Ask another administrator.", "forbidden");
    }
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
 * can move them all at once with `reassignOpenTasks`.
 *
 * Nobody can switch themselves off: an administrator doing so by accident
 * would leave the church with nobody to switch them back on.
 */
export function setTeamMemberActive(
  snapshot: ChurchSnapshot,
  teamMemberId: string,
  active: boolean,
  ctx?: Pick<CommandContext, "actorId">,
): Result<CommandResult & { openTasks: number }> {
  const member = snapshot.team.find((entry) => entry.id === teamMemberId);
  if (!member) return err("That team member no longer exists.", "not_found");
  if (!active && ctx?.actorId === teamMemberId) {
    return err("You can't switch yourself off. Ask another administrator.", "forbidden");
  }

  const open = openTasksFor(snapshot, teamMemberId);

  return ok({
    ...result(
      patch(snapshot, {
        team: snapshot.team.map((entry) => (entry.id === teamMemberId ? { ...entry, active } : entry)),
      }),
      [],
      [
        `${member.name} marked as ${active ? "active" : "inactive"}.`,
        ...(!active && open.length
          ? [`${open.length} open follow-up${open.length === 1 ? " is" : "s are"} still with them. Move them to someone else.`]
          : []),
      ],
    ),
    openTasks: active ? 0 : open.length,
  });
}

/**
 * Moves every open follow-up from one team member to another active one,
 * typically after the first has been switched off or their account removed.
 */
export function reassignOpenTasks(
  snapshot: ChurchSnapshot,
  input: { fromTeamMemberId: string; toTeamMemberId: string },
  ctx: CommandContext,
): Result<CommandResult & { moved: number }> {
  const from = snapshot.team.find((entry) => entry.id === input.fromTeamMemberId);
  if (!from) return err("That team member no longer exists.", "not_found");
  const to = teamMember(snapshot, input.toTeamMemberId);
  if (!to) return err("The person you chose is no longer on the team.", "not_found");
  if (to.id === from.id) return err("Choose somebody else to take them.", "invalid");
  if (!to.active) return err(`${to.name} is marked as inactive and can't take new tasks.`, "inactive");
  if (to.role === "member") return err(`${to.name} isn't on the follow-up team.`, "invalid");

  const moving = openTasksFor(snapshot, from.id);
  if (!moving.length) return err(`${from.name} has no open follow-ups left to move.`, "unchanged");

  const ids = new Set(moving.map((task) => task.id));
  const next = patch(snapshot, {
    tasks: snapshot.tasks.map((task) => (ids.has(task.id) ? { ...task, assigneeId: to.id } : task)),
  });

  return ok({
    ...result(
      withActivity(
        next,
        ctx,
        moving.map((task) =>
          activity(ctx, {
            type: "follow_up.assigned",
            category: "follow_up",
            personId: task.personId,
            summary: `${task.reference} moved from ${from.name} to ${to.name}.`,
            // Pastoral follow-ups stay as private as the care they belong to.
            visibility: task.type === "pastoral_contact" ? "restricted" : "general",
            meta: { taskId: task.id },
          }),
        ),
      ),
      [],
      [`${moving.length} open follow-up${moving.length === 1 ? "" : "s"} moved to ${to.name}.`],
    ),
    moved: moving.length,
  });
}
