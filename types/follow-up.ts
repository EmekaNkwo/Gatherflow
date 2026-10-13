import type {
  IsoDate,
  IsoDateTime,
  PersonId,
  StageId,
  TaskId,
  TeamMemberId,
} from "./common";

export type FollowUpTaskType =
  | "welcome_message"
  | "phone_call"
  | "check_in"
  | "service_invitation"
  | "group_invitation"
  | "membership_orientation"
  | "pastoral_contact"
  | "post_event_follow_up";

export const FOLLOW_UP_TASK_TYPES: readonly FollowUpTaskType[] = [
  "welcome_message",
  "phone_call",
  "check_in",
  "service_invitation",
  "group_invitation",
  "membership_orientation",
  "pastoral_contact",
  "post_event_follow_up",
];

export const FOLLOW_UP_TASK_TYPE_LABELS: Record<FollowUpTaskType, string> = {
  welcome_message: "Welcome message",
  phone_call: "Phone call",
  check_in: "Check-in message",
  service_invitation: "Invitation to a service",
  group_invitation: "Invitation to a group",
  membership_orientation: "Membership orientation",
  pastoral_contact: "Pastoral-care contact",
  post_event_follow_up: "Follow-up after an event",
};

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "rescheduled"
  | "cancelled";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "rescheduled",
  "cancelled",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

export type TaskPriority = "normal" | "high" | "urgent";

export const TASK_PRIORITIES: readonly TaskPriority[] = ["normal", "high", "urgent"];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export type TaskOutcome =
  | "contacted"
  | "no_answer"
  | "requested_another_time"
  | "not_interested"
  | "wrong_details"
  | "needs_another_team"
  | "other";

export const TASK_OUTCOMES: readonly TaskOutcome[] = [
  "contacted",
  "no_answer",
  "requested_another_time",
  "not_interested",
  "wrong_details",
  "needs_another_team",
  "other",
];

export const TASK_OUTCOME_LABELS: Record<TaskOutcome, string> = {
  contacted: "Successfully contacted",
  no_answer: "No answer",
  requested_another_time: "Requested another time",
  not_interested: "Not interested",
  wrong_details: "Wrong contact details",
  needs_another_team: "Needs another team",
  other: "Other",
};

export interface TaskReschedule {
  from: IsoDate;
  to: IsoDate;
  at: IsoDateTime;
  by: TeamMemberId;
  reason?: string;
}

export interface FollowUpTask {
  id: TaskId;
  /** Human-facing reference such as `FU-0184`. */
  reference: string;
  personId: PersonId;
  type: FollowUpTaskType;
  assigneeId?: TeamMemberId;
  priority: TaskPriority;
  dueDate: IsoDate;
  status: TaskStatus;
  notes?: string;
  outcome?: TaskOutcome;
  outcomeNote?: string;
  /** `manual` or the id of the automation rule that produced the task. */
  origin: "manual" | `rule:${string}`;
  /**
   * Stable key used to guarantee a rule never creates the same task twice,
   * however many times its trigger is replayed.
   */
  automationKey?: string;
  rescheduleHistory: readonly TaskReschedule[];
  createdAt: IsoDateTime;
  createdBy: TeamMemberId;
  completedAt?: IsoDateTime;
  completedBy?: TeamMemberId;
}

/** A configurable stage in the visitor follow-up pipeline. */
export interface PipelineStage {
  id: StageId;
  name: string;
  description?: string;
  order: number;
  /** `terminal` stages stop automated follow-up creation. */
  kind: "active" | "terminal";
  /** Shown as the suggested next action for cards in this stage. */
  suggestedAction?: string;
}
