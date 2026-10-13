import type {
  IsoDateTime,
  PersonId,
  TeamMemberId,
  Visibility,
} from "./common";

export type ActivityCategory =
  | "visitor"
  | "follow_up"
  | "attendance"
  | "membership"
  | "group"
  | "communication"
  | "care"
  | "system";

export type ActivityType =
  | "visitor.registered"
  | "visitor.self_registered"
  | "visitor.assigned"
  | "visitor.stage_changed"
  | "visitor.closed"
  | "visitor.contact_preference_changed"
  | "visitor.membership_interest"
  | "follow_up.created"
  | "follow_up.assigned"
  | "follow_up.rescheduled"
  | "follow_up.completed"
  | "follow_up.cancelled"
  | "attendance.recorded"
  | "attendance.corrected"
  | "attendance.session_created"
  | "membership.registered"
  | "membership.status_changed"
  | "membership.orientation_completed"
  | "group.joined"
  | "group.left"
  | "group.created"
  | "communication.logged"
  | "care.created"
  | "care.updated"
  | "system.seeded"
  | "system.reset"
  | "system.imported";

/**
 * Append-only timeline entry. `restricted` entries are excluded from the
 * dashboard feed, global search results and CSV exports.
 */
export interface ActivityEvent {
  id: string;
  type: ActivityType;
  category: ActivityCategory;
  personId?: PersonId;
  actorId?: TeamMemberId;
  /** Short human-readable sentence, safe for general display. */
  summary: string;
  at: IsoDateTime;
  visibility: Visibility;
  /** Optional structured detail for deep links (task id, session id, ...). */
  meta?: Readonly<Record<string, string>>;
}

/** A milestone in the visitor-to-member journey. */
export type JourneyMilestoneKey =
  | "first_visit"
  | "follow_up_completed"
  | "second_visit"
  | "membership_interest"
  | "orientation_completed"
  | "membership_confirmed"
  | "group_joined"
  | "ministry_involvement";

export const JOURNEY_MILESTONE_LABELS: Record<JourneyMilestoneKey, string> = {
  first_visit: "First visit",
  follow_up_completed: "Follow-up completed",
  second_visit: "Second visit",
  membership_interest: "Membership interest expressed",
  orientation_completed: "Membership orientation completed",
  membership_confirmed: "Membership confirmed",
  group_joined: "Connect group joined",
  ministry_involvement: "Ministry involvement started",
};

export interface JourneyMilestone {
  key: JourneyMilestoneKey;
  label: string;
  /** `undefined` when the milestone has not been reached. */
  at?: IsoDateTime;
  /** Optional milestones never block the ones that follow them. */
  optional: boolean;
  detail?: string;
}
