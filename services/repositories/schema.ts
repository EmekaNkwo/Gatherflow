import { z } from "zod";
import { CONTACT_METHODS } from "@/types/common";
import {
  MEMBERSHIP_STATUSES,
  VISITOR_SOURCES,
  type Household,
  type Person,
} from "@/types/person";
import {
  FOLLOW_UP_TASK_TYPES,
  TASK_OUTCOMES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type FollowUpTask,
  type PipelineStage,
} from "@/types/follow-up";
import {
  SERVICE_TYPES,
  type AttendanceRecord,
  type AttendanceSession,
} from "@/types/attendance";
import { GROUP_TYPES, WEEKDAYS, type Group } from "@/types/group";
import { CARE_STATUSES, type CareRecord } from "@/types/care";
import type { CommunicationLogEntry, MessageTemplate } from "@/types/communication";
import { DEMO_ROLES, type TeamMember } from "@/types/team";
import type { ActivityEvent } from "@/types/activity";
import { AUTOMATION_RULE_IDS, type ChurchSettings } from "@/types/settings";

/**
 * Validation at the storage boundary. Anything that fails these schemas is
 * dropped with a warning rather than crashing the app, so a half-written or
 * hand-edited localStorage entry can never lock a user out.
 *
 * The `z.ZodType<T>` annotations tie each schema to its domain type, so a
 * change to the types breaks the build here instead of at runtime.
 */
function enumOf<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoDateTime = z.string().min(20);
const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm");

const contactPreferencesSchema = z.object({
  preferredMethod: enumOf(CONTACT_METHODS),
  permissionGranted: z.boolean(),
  optedOut: z.boolean(),
  optedOutAt: isoDateTime.optional(),
  optOutReason: z.string().optional(),
  maxContactAttempts: z.number().int().positive().optional(),
});

const visitorProfileSchema = z.object({
  firstVisitDate: isoDate,
  source: enumOf(VISITOR_SOURCES),
  firstSessionId: z.string().optional(),
  assignedTo: z.string().optional(),
  stageId: z.string(),
  stageUpdatedAt: isoDateTime,
  lastContactAt: isoDateTime.optional(),
  contactAttempts: z.number().int().min(0),
  membershipInterestAt: isoDateTime.optional(),
  closure: z
    .object({
      reason: z.enum([
        "paused",
        "contact_later",
        "contact_declined",
        "no_response",
        "referred",
        "closed",
      ]),
      note: z.string().optional(),
      recordedAt: isoDateTime,
    })
    .optional(),
  notes: z.string().optional(),
});

const memberProfileSchema = z.object({
  reference: z.string(),
  status: enumOf(MEMBERSHIP_STATUSES),
  membershipDate: isoDate,
  preferredServiceType: z.string().optional(),
  statusHistory: z.array(
    z.object({
      status: enumOf(MEMBERSHIP_STATUSES),
      changedAt: isoDateTime,
      changedBy: z.string(),
      reason: z.string().optional(),
    }),
  ),
  emergencyContact: z
    .object({
      name: z.string(),
      relationship: z.string(),
      phone: z.string(),
    })
    .optional(),
  requestedContact: z.boolean().optional(),
});

export const personSchema: z.ZodType<Person> = z.object({
  id: z.string(),
  kind: z.enum(["visitor", "member"]),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  preferredName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  ageGroup: z.enum(["child", "youth", "adult"]).optional(),
  householdId: z.string().optional(),
  interests: z.array(z.string()),
  groupIds: z.array(z.string()),
  contact: contactPreferencesSchema,
  visitor: visitorProfileSchema.optional(),
  member: memberProfileSchema.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const householdSchema: z.ZodType<Household> = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string().optional(),
  primaryContactId: z.string().optional(),
  createdAt: isoDateTime,
});

export const pipelineStageSchema: z.ZodType<PipelineStage> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  order: z.number().int(),
  kind: z.enum(["active", "terminal"]),
  suggestedAction: z.string().optional(),
});

export const followUpTaskSchema: z.ZodType<FollowUpTask> = z.object({
  id: z.string(),
  reference: z.string(),
  personId: z.string(),
  type: enumOf(FOLLOW_UP_TASK_TYPES),
  assigneeId: z.string().optional(),
  priority: enumOf(TASK_PRIORITIES),
  dueDate: isoDate,
  status: enumOf(TASK_STATUSES),
  notes: z.string().optional(),
  outcome: enumOf(TASK_OUTCOMES).optional(),
  outcomeNote: z.string().optional(),
  origin: z.union([
    z.literal("manual"),
    z
      .string()
      .regex(/^rule:/)
      .transform((value) => value as `rule:${string}`),
  ]),
  automationKey: z.string().optional(),
  rescheduleHistory: z.array(
    z.object({
      from: isoDate,
      to: isoDate,
      at: isoDateTime,
      by: z.string(),
      reason: z.string().optional(),
    }),
  ),
  createdAt: isoDateTime,
  createdBy: z.string(),
  completedAt: isoDateTime.optional(),
  completedBy: z.string().optional(),
});

export const attendanceSessionSchema: z.ZodType<AttendanceSession> = z.object({
  id: z.string(),
  name: z.string(),
  date: isoDate,
  startTime: timeOfDay,
  type: enumOf(SERVICE_TYPES),
  groupId: z.string().optional(),
  notes: z.string().optional(),
  createdAt: isoDateTime,
});

export const attendanceRecordSchema: z.ZodType<AttendanceRecord> = z.object({
  id: z.string(),
  sessionId: z.string(),
  personId: z.string(),
  method: z.enum([
    "search",
    "manual",
    "new_visitor",
    "csv_import",
    "qr_demo",
    "self_registration",
  ]),
  status: z.enum(["present", "removed"]),
  recordedAt: isoDateTime,
  recordedBy: z.string(),
  firstVisit: z.boolean(),
  corrections: z.array(
    z.object({
      at: isoDateTime,
      by: z.string(),
      action: z.enum(["removed", "restored", "moved_session"]),
      reason: z.string().optional(),
      previousSessionId: z.string().optional(),
    }),
  ),
});

export const groupSchema: z.ZodType<Group> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: enumOf(GROUP_TYPES),
  leaderId: z.string().optional(),
  members: z.array(
    z.object({
      personId: z.string(),
      joinedAt: isoDateTime,
      addedBy: z.string(),
      role: z.enum(["member", "leader", "assistant"]).optional(),
    }),
  ),
  schedule: z
    .object({
      weekday: enumOf(WEEKDAYS),
      time: timeOfDay,
      frequency: z.enum(["weekly", "fortnightly", "monthly"]),
    })
    .optional(),
  location: z.string().optional(),
  active: z.boolean(),
  involvesMinors: z.boolean(),
  createdAt: isoDateTime,
});

export const careRecordSchema: z.ZodType<CareRecord> = z.object({
  id: z.string(),
  reference: z.string(),
  personId: z.string(),
  category: z.enum([
    "prayer_request",
    "hospital_visit",
    "bereavement",
    "practical_support",
    "counselling_request",
    "new_parent",
    "other",
  ]),
  summary: z.string(),
  assigneeId: z.string().optional(),
  receivedAt: isoDate,
  nextAction: z.string().optional(),
  nextActionDate: isoDate.optional(),
  status: enumOf(CARE_STATUSES),
  notes: z.array(
    z.object({
      at: isoDateTime,
      by: z.string(),
      text: z.string(),
      visibility: z.literal("restricted"),
    }),
  ),
  appointments: z.array(
    z.object({
      id: z.string(),
      date: isoDate,
      time: timeOfDay,
      location: z.string().optional(),
      status: z.enum(["scheduled", "completed", "cancelled"]),
    }),
  ),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const messageTemplateSchema: z.ZodType<MessageTemplate> = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum([
    "visitor_welcome",
    "thank_you",
    "service_invitation",
    "post_event",
    "membership_orientation",
    "group_invitation",
    "general_check_in",
  ]),
  channels: z.array(enumOf(CONTACT_METHODS)),
  body: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  builtIn: z.boolean(),
});

export const communicationLogSchema: z.ZodType<CommunicationLogEntry> = z.object({
  id: z.string(),
  personId: z.string(),
  templateId: z.string().optional(),
  taskId: z.string().optional(),
  channel: enumOf(CONTACT_METHODS),
  status: z.enum(["drafted", "copied", "opened_external", "simulated_sent"]),
  body: z.string(),
  at: isoDateTime,
  actorId: z.string(),
  simulated: z.literal(true),
});

export const teamMemberSchema: z.ZodType<TeamMember> = z.object({
  id: z.string(),
  name: z.string(),
  role: enumOf(DEMO_ROLES),
  personId: z.string().optional(),
  active: z.boolean(),
  title: z.string().optional(),
  createdAt: isoDateTime,
});

export const activityEventSchema: z.ZodType<ActivityEvent> = z.object({
  id: z.string(),
  type: z.string() as unknown as z.ZodType<ActivityEvent["type"]>,
  category: z.enum([
    "visitor",
    "follow_up",
    "attendance",
    "membership",
    "group",
    "communication",
    "care",
    "system",
  ]),
  personId: z.string().optional(),
  actorId: z.string().optional(),
  summary: z.string(),
  at: isoDateTime,
  visibility: z.enum(["general", "restricted"]),
  meta: z.record(z.string(), z.string()).optional(),
});

export const churchSettingsSchema: z.ZodType<ChurchSettings> = z.object({
  churchName: z.string().min(1),
  timezoneLabel: z.string(),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: enumOf(SERVICE_TYPES),
      weekday: enumOf(WEEKDAYS),
      time: timeOfDay,
      active: z.boolean(),
    }),
  ),
  pipelineStages: z.array(pipelineStageSchema),
  automationRules: z.array(
    z.object({
      id: enumOf(AUTOMATION_RULE_IDS),
      enabled: z.boolean(),
      dueInDays: z.number().int().min(0).max(90),
      defaultAssigneeId: z.string().optional(),
    }),
  ),
  engagement: z.object({
    inactiveAfterWeeksAbsent: z.number().int().min(1).max(52),
    attendanceAverageWeeks: z.number().int().min(1).max(52),
    maxContactAttempts: z.number().int().min(1).max(10),
  }),
  defaultFollowUpDueInDays: z.number().int().min(0).max(90),
});

/** Per-collection schemas, used by the snapshot repository. */
export const collectionSchemas = {
  people: personSchema,
  households: householdSchema,
  groups: groupSchema,
  tasks: followUpTaskSchema,
  sessions: attendanceSessionSchema,
  attendance: attendanceRecordSchema,
  careRecords: careRecordSchema,
  templates: messageTemplateSchema,
  communications: communicationLogSchema,
  team: teamMemberSchema,
  activity: activityEventSchema,
} as const;

export type CollectionName = keyof typeof collectionSchemas;
