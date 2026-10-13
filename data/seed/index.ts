import type { ChurchSnapshot } from "@/types/snapshot";
import { createSeedContext } from "./context";
import { createActivity } from "./activity";
import { createAttendance } from "./attendance";
import { createCareRecords } from "./care";
import { createCommunications } from "./communications";
import { createGroups } from "./groups";
import { createPeople } from "./people";
import { createSettings } from "./settings";
import { createTasks } from "./tasks";
import { createTeam } from "./team";
import { createTemplates } from "./templates";

/**
 * Builds the complete demo church.
 *
 * Everything is derived from `now`, so the dashboard always has work due
 * today, a few genuinely overdue tasks and ten weeks of attendance history —
 * and because the generator is deterministic, the numbers never drift
 * between reloads.
 */
export function createSeedSnapshot(now: Date = new Date()): ChurchSnapshot {
  const ctx = createSeedContext(now);
  const settings = createSettings();
  const team = createTeam(ctx);

  const seededPeople = createPeople(ctx);
  const { groups, people } = createGroups(ctx, seededPeople.people);
  const { sessions, attendance } = createAttendance(
    ctx,
    people,
    seededPeople.patterns,
    seededPeople.visitorPlans,
  );
  const tasks = createTasks(ctx, people, seededPeople.visitorPlans);
  const templates = createTemplates(ctx);
  const careRecords = createCareRecords(ctx, people);
  const communications = createCommunications(
    ctx,
    people,
    tasks,
    templates,
    settings.churchName,
  );
  const activity = createActivity(ctx, {
    people,
    tasks,
    sessions,
    attendance,
    groups,
    careRecords,
    communications,
  });

  return {
    people,
    households: seededPeople.households,
    groups,
    tasks,
    sessions,
    attendance,
    careRecords,
    templates,
    communications,
    team,
    activity,
    settings,
  };
}

export { TEAM_IDS } from "./team";
export { DEFAULT_PIPELINE_STAGES, DEFAULT_SERVICES } from "./settings";
