import { createSeedContext } from "@/data/seed/context";
import { createSettings } from "@/data/seed/settings";
import { createTemplates } from "@/data/seed/templates";
import { createId } from "@/lib/ids";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { TeamMember } from "@/types/team";

/**
 * A church as it exists the moment somebody creates it: no people, no
 * history, the built-in message templates, sensible defaults for the
 * pipeline and the automation rules, and one team member — the person who
 * created it, as its administrator. Everything else is theirs to add.
 */
export interface EmptyChurchInput {
  churchName: string;
  /** The creator, who becomes the first team member and administrator. */
  founder: { teamMemberId: string; name: string };
  now?: Date;
}

export function createEmptySnapshot(input: EmptyChurchInput): ChurchSnapshot {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const defaults = createSettings();

  const founder: TeamMember = {
    id: input.founder.teamMemberId,
    name: input.founder.name.trim() || "Administrator",
    role: "administrator",
    active: true,
    title: "Church administrator",
    createdAt: nowIso,
  };

  return {
    people: [],
    households: [],
    groups: [],
    tasks: [],
    sessions: [],
    attendance: [],
    careRecords: [],
    templates: createTemplates(createSeedContext(now)).map((template) => ({
      ...template,
      id: createId("template"),
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
    communications: [],
    team: [founder],
    activity: [],
    settings: {
      ...defaults,
      churchName: input.churchName.trim(),
      // The defaults point rules at demo team members that do not exist
      // here; the founder is the only person work can go to until the team
      // is set up.
      automationRules: defaults.automationRules.map((rule) =>
        "defaultAssigneeId" in rule && rule.defaultAssigneeId
          ? { ...rule, defaultAssigneeId: founder.id }
          : rule,
      ),
    },
  };
}
