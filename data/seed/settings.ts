import type { PipelineStage } from "@/types/follow-up";
import type { ChurchSettings, ServiceDefinition } from "@/types/settings";
import { TEAM_IDS } from "./team";

/**
 * Default pipeline. Churches can reorder, rename or remove stages in
 * Settings; nothing in the code assumes a fixed number of stages.
 */
export const DEFAULT_PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: "new_visitor",
    name: "New visitor",
    description: "Registered, not yet assigned to anyone.",
    order: 1,
    kind: "active",
    suggestedAction: "Assign a follow-up person",
  },
  {
    id: "contact_pending",
    name: "Contact pending",
    description: "Assigned and waiting for a first contact.",
    order: 2,
    kind: "active",
    suggestedAction: "Make first contact",
  },
  {
    id: "contact_attempted",
    name: "Contact attempted",
    description: "We tried but have not spoken yet.",
    order: 3,
    kind: "active",
    suggestedAction: "Try again at a different time",
  },
  {
    id: "contacted",
    name: "Contacted",
    description: "We have spoken to the visitor.",
    order: 4,
    kind: "active",
    suggestedAction: "Invite to the next service",
  },
  {
    id: "invited_to_return",
    name: "Invited to return",
    description: "Invitation given, waiting to see them again.",
    order: 5,
    kind: "active",
    suggestedAction: "Check in after the next service",
  },
  {
    id: "returned",
    name: "Returned",
    description: "Attended again after their first visit.",
    order: 6,
    kind: "active",
    suggestedAction: "Ask whether they would like to know more",
  },
  {
    id: "membership_orientation",
    name: "Membership orientation",
    description: "Booked onto or attending orientation.",
    order: 7,
    kind: "active",
    suggestedAction: "Confirm orientation attendance",
  },
  {
    id: "connected",
    name: "Connected",
    description: "Settled in a group or ministry.",
    order: 8,
    kind: "terminal",
    suggestedAction: "No further follow-up needed",
  },
  {
    id: "closed",
    name: "Closed",
    description: "Follow-up stopped — paused, declined or referred on.",
    order: 9,
    kind: "terminal",
    suggestedAction: "No further contact",
  },
];

export const DEFAULT_SERVICES: readonly ServiceDefinition[] = [
  {
    id: "svc_sunday_main",
    name: "Sunday service",
    type: "sunday_service",
    weekday: "sunday",
    time: "10:00",
    active: true,
  },
  {
    id: "svc_midweek",
    name: "Midweek service",
    type: "midweek_service",
    weekday: "wednesday",
    time: "18:30",
    active: true,
  },
  {
    id: "svc_prayer",
    name: "Prayer meeting",
    type: "prayer_meeting",
    weekday: "friday",
    time: "19:00",
    active: true,
  },
  {
    id: "svc_youth",
    name: "Youth gathering",
    type: "youth_gathering",
    weekday: "saturday",
    time: "16:00",
    active: true,
  },
];

export function createSettings(): ChurchSettings {
  return {
    churchName: "Grace Community Church",
    timezoneLabel: "Local church time",
    services: DEFAULT_SERVICES,
    pipelineStages: DEFAULT_PIPELINE_STAGES,
    automationRules: [
      {
        id: "first_visit_welcome",
        enabled: true,
        dueInDays: 2,
        defaultAssigneeId: TEAM_IDS.coordinator,
      },
      { id: "overdue_alert", enabled: true, dueInDays: 0 },
      { id: "return_visit_review", enabled: true, dueInDays: 3 },
      {
        id: "membership_orientation",
        enabled: true,
        dueInDays: 7,
        defaultAssigneeId: TEAM_IDS.admin,
      },
      {
        id: "next_action_suggestion",
        enabled: true,
        dueInDays: 5,
        defaultAssigneeId: TEAM_IDS.coordinator,
      },
    ],
    engagement: {
      inactiveAfterWeeksAbsent: 8,
      attendanceAverageWeeks: 6,
      maxContactAttempts: 3,
    },
    defaultFollowUpDueInDays: 3,
  };
}
