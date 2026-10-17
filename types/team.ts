import type { IsoDateTime, PersonId, TeamMemberId } from "./common";

/**
 * Roles. Each account holds one per church, read from its membership row on
 * every request and enforced on the server; the interface only reflects it.
 */
export type DemoRole =
  | "administrator"
  | "pastor"
  | "follow_up_coordinator"
  | "volunteer"
  | "member";

export const DEMO_ROLES: readonly DemoRole[] = [
  "administrator",
  "pastor",
  "follow_up_coordinator",
  "volunteer",
  "member",
];

export const DEMO_ROLE_LABELS: Record<DemoRole, string> = {
  administrator: "Administrator",
  pastor: "Pastor",
  follow_up_coordinator: "Follow-up coordinator",
  volunteer: "Volunteer",
  member: "Member",
};

export const DEMO_ROLE_DESCRIPTIONS: Record<DemoRole, string> = {
  administrator: "Manages configuration, records, teams and reports.",
  pastor: "Reviews engagement and authorised pastoral-care records.",
  follow_up_coordinator: "Assigns tasks and manages the visitor pipeline.",
  volunteer: "Works assigned tasks and records follow-up outcomes.",
  member: "Sees a limited personal profile and permitted events.",
};

/** Capabilities checked by the simulated permission model. */
export type Capability =
  | "people.read"
  | "people.write"
  | "visitors.write"
  | "tasks.read.all"
  | "tasks.read.own"
  | "tasks.write"
  | "tasks.assign"
  | "attendance.write"
  | "groups.write"
  | "care.read"
  | "care.write"
  | "communications.write"
  | "analytics.read"
  | "settings.write"
  | "exports.run";

export interface TeamMember {
  id: TeamMemberId;
  name: string;
  role: DemoRole;
  /** Set when the team member is also in the people directory. */
  personId?: PersonId;
  active: boolean;
  /** Short note shown in the team view, e.g. "Welcome desk lead". */
  title?: string;
  createdAt: IsoDateTime;
}

export interface VolunteerWorkload {
  member: TeamMember;
  assigned: number;
  dueToday: number;
  overdue: number;
  completed: number;
  completedOnTime: number;
}
