import type { GroupId, IsoDateTime, PersonId, TeamMemberId } from "./common";

export type GroupType =
  | "connect_group"
  | "ministry"
  | "choir"
  | "youth"
  | "children"
  | "outreach"
  | "prayer";

export const GROUP_TYPES: readonly GroupType[] = [
  "connect_group",
  "ministry",
  "choir",
  "youth",
  "children",
  "outreach",
  "prayer",
];

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  connect_group: "Connect group",
  ministry: "Ministry team",
  choir: "Choir",
  youth: "Youth ministry",
  children: "Children's ministry",
  outreach: "Community outreach",
  prayer: "Prayer team",
};

export type Weekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const WEEKDAYS: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export interface GroupSchedule {
  weekday: Weekday;
  /** Local start time in `HH:mm`. */
  time: string;
  frequency: "weekly" | "fortnightly" | "monthly";
}

export interface GroupMembership {
  personId: PersonId;
  joinedAt: IsoDateTime;
  /** Who recorded the assignment — people are never auto-added to a group. */
  addedBy: TeamMemberId;
  role?: "member" | "leader" | "assistant";
}

export interface Group {
  id: GroupId;
  name: string;
  description: string;
  type: GroupType;
  leaderId?: PersonId;
  members: readonly GroupMembership[];
  schedule?: GroupSchedule;
  location?: string;
  active: boolean;
  /** Groups working with minors are flagged so the UI can restrict details. */
  involvesMinors: boolean;
  createdAt: IsoDateTime;
}
