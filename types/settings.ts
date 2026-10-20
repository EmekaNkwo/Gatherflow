import type { TeamMemberId } from "./common";
import type { PipelineStage } from "./follow-up";
import type { ServiceType } from "./attendance";
import type { Weekday } from "./group";

/** Known automation rules. Each one is individually configurable. */
export type AutomationRuleId =
  | "first_visit_welcome"
  | "overdue_alert"
  | "return_visit_review"
  | "membership_orientation"
  | "next_action_suggestion";

export const AUTOMATION_RULE_IDS: readonly AutomationRuleId[] = [
  "first_visit_welcome",
  "overdue_alert",
  "return_visit_review",
  "membership_orientation",
  "next_action_suggestion",
];

export const AUTOMATION_RULE_LABELS: Record<AutomationRuleId, string> = {
  first_visit_welcome: "Welcome task for first-time visitors",
  overdue_alert: "Overdue follow-up alerts",
  return_visit_review: "Review next action when a visitor returns",
  membership_orientation: "Orientation task on membership interest",
  next_action_suggestion: "Suggest the next action after an outcome",
};

export const AUTOMATION_RULE_DESCRIPTIONS: Record<AutomationRuleId, string> = {
  first_visit_welcome:
    "When a first-time visitor is registered, create a welcome follow-up task and assign it to the follow-up team.",
  overdue_alert:
    "When a follow-up task passes its due date, surface it in the overdue alerts on the coordinator dashboard.",
  return_visit_review:
    "When a visitor attends another service, update the visit count and journey, then review the next follow-up action.",
  membership_orientation:
    "When a visitor asks about membership, create a membership orientation task for an appropriate team member.",
  next_action_suggestion:
    "When a follow-up is completed, create the natural next action — and nothing at all if the person has asked us to stop.",
};

export interface AutomationRuleConfig {
  id: AutomationRuleId;
  enabled: boolean;
  /** Days after the trigger that the generated task becomes due. */
  dueInDays: number;
  /** Team member the generated task is assigned to, when the rule assigns. */
  defaultAssigneeId?: TeamMemberId;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  type: ServiceType;
  weekday: Weekday;
  /** Local start time in `HH:mm`. */
  time: string;
  active: boolean;
}

/**
 * Criteria behind "inactive" reporting. Always shown next to the figures so a
 * member never appears in a report without an explanation.
 */
export interface EngagementCriteria {
  /** Consecutive weeks without any recorded attendance. */
  inactiveAfterWeeksAbsent: number;
  /** Weeks of history used for the average weekly attendance figure. */
  attendanceAverageWeeks: number;
  /** Attempts after which a visitor is marked as "no response". */
  maxContactAttempts: number;
}

export interface ChurchSettings {
  churchName: string;
  timezoneLabel: string;
  services: readonly ServiceDefinition[];
  pipelineStages: readonly PipelineStage[];
  automationRules: readonly AutomationRuleConfig[];
  engagement: EngagementCriteria;
  /** Default due window for manually created follow-up tasks. */
  defaultFollowUpDueInDays: number;
  /**
   * Country calling code (digits, no `+`) assumed for phone numbers typed in
   * local form, so a WhatsApp link reaches the right person. Missing means
   * `DEFAULT_COUNTRY_CALLING_CODE` from `lib/phone.ts`.
   */
  defaultCountryCallingCode?: string;
}
