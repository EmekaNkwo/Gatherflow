import type { ActivityEvent } from "./activity";
import type { AttendanceRecord, AttendanceSession } from "./attendance";
import type { CareRecord } from "./care";
import type { CommunicationLogEntry, MessageTemplate } from "./communication";
import type { FollowUpTask } from "./follow-up";
import type { Group } from "./group";
import type { Household, Person } from "./person";
import type { ChurchSettings } from "./settings";
import type { TeamMember } from "./team";

/**
 * The complete application state. Every domain command takes a snapshot and
 * returns a new one, which makes the business rules pure and testable and
 * keeps persistence a single, explicit step.
 */
export interface ChurchSnapshot {
  people: readonly Person[];
  households: readonly Household[];
  groups: readonly Group[];
  tasks: readonly FollowUpTask[];
  sessions: readonly AttendanceSession[];
  attendance: readonly AttendanceRecord[];
  careRecords: readonly CareRecord[];
  templates: readonly MessageTemplate[];
  communications: readonly CommunicationLogEntry[];
  team: readonly TeamMember[];
  activity: readonly ActivityEvent[];
  settings: ChurchSettings;
}

/** Keys of the collections that the persistence layer writes individually. */
export type SnapshotCollectionKey = keyof ChurchSnapshot;

export const SNAPSHOT_KEYS: readonly SnapshotCollectionKey[] = [
  "people",
  "households",
  "groups",
  "tasks",
  "sessions",
  "attendance",
  "careRecords",
  "templates",
  "communications",
  "team",
  "activity",
  "settings",
];
