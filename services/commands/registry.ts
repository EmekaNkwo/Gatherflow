import { z } from "zod";
import type { Result } from "@/lib/result";
import type { CommandContext } from "@/services/core/context";
import type { CommandResult } from "@/services/core/events";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { Capability } from "@/types/team";
import { CONTACT_METHODS } from "@/types/common";
import { MEMBERSHIP_STATUSES, VISITOR_SOURCES } from "@/types/person";
import { FOLLOW_UP_TASK_TYPES, TASK_OUTCOMES, TASK_PRIORITIES } from "@/types/follow-up";
import { SERVICE_TYPES } from "@/types/attendance";
import { GROUP_TYPES, WEEKDAYS } from "@/types/group";
import { CARE_STATUSES } from "@/types/care";
import { DEMO_ROLES } from "@/types/team";
import { AUTOMATION_RULE_IDS } from "@/types/settings";

import { registerVisitor, recordReturnVisit } from "@/services/visitors/registration";
import {
  assignVisitor,
  closeFollowUp,
  setContactPreferences,
  setStage,
} from "@/services/visitors/pipeline";
import {
  assignTask,
  cancelTask,
  createFollowUpTask,
  rescheduleTask,
  startTask,
} from "@/services/follow-ups/tasks";
import { completeTask } from "@/services/follow-ups/completion";
import {
  changeMembershipStatus,
  recordMembershipInterest,
  recordOrientationCompleted,
  registerMember,
  setEmergencyContact,
  setRequestedContact,
} from "@/services/members/membership";
import {
  correctPerson,
  createHousehold,
  deletePerson,
  setHousehold,
} from "@/services/people/people";
import {
  importAttendanceCsv,
  moveAttendance,
  recordAttendance,
  removeAttendance,
} from "@/services/attendance/check-in";
import { createSession, updateSessionNotes } from "@/services/attendance/sessions";
import {
  addGroupMember,
  createGroup,
  removeGroupMember,
  setGroupActive,
  setGroupLeader,
} from "@/services/groups/groups";
import { logCommunication } from "@/services/communications/messaging";
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
} from "@/services/communications/templates";
import {
  addCareNote,
  createCareRecord,
  scheduleCareAppointment,
  setAppointmentStatus,
  updateCareRecord,
} from "@/services/care/care";
import {
  setTeamMemberActive,
  updateAutomationRule,
  updateChurchProfile,
  updateEngagementCriteria,
  updatePipelineStages,
  updateServices,
  upsertTeamMember,
} from "@/services/settings/settings";

/**
 * The command registry: every change the application can make, named.
 *
 * Each entry binds three things that must never drift apart — the capability
 * required, the shape of the input, and the function that applies it. There is
 * one registry, used by both sides:
 *
 * - In the browser it is a lookup: the store finds the command and runs it
 *   against the local snapshot, exactly as before.
 * - On the server the same entry supplies the capability to check and the
 *   schema to validate the request body against before the same function runs.
 *
 * Because the binding exists once, a command cannot be exposed over HTTP
 * without declaring what it requires, and the browser cannot run something the
 * server would refuse.
 *
 * Commands are referred to by name because a closure cannot cross a network.
 */

function enumOf<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}

const id = z.string().min(1);
const optionalId = id.optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm");
const shortText = z.string().max(500);
const name = z.string().trim().min(1).max(80);

const contactMethod = enumOf(CONTACT_METHODS);
const ageGroup = z.enum(["child", "youth", "adult"]);
const closureReason = z.enum([
  "paused",
  "contact_later",
  "contact_declined",
  "no_response",
  "referred",
  "closed",
]);
const checkInMethod = z.enum([
  "search",
  "manual",
  "new_visitor",
  "csv_import",
  "qr_demo",
  "self_registration",
]);
const careCategory = z.enum([
  "prayer_request",
  "hospital_visit",
  "bereavement",
  "practical_support",
  "counselling_request",
  "new_parent",
  "other",
]);
const templateCategory = z.enum([
  "visitor_welcome",
  "thank_you",
  "service_invitation",
  "post_event",
  "membership_orientation",
  "group_invitation",
  "general_check_in",
]);
const communicationStatus = z.enum([
  "drafted",
  "copied",
  "opened_external",
  "simulated_sent",
]);

/**
 * A command, as both sides need to see it.
 *
 * `O` carries the extra payload some commands report alongside the snapshot —
 * the id of the thing just created, say — which callers use to navigate. It is
 * part of the type so that payload survives the trip over HTTP rather than
 * being silently dropped.
 */
export interface CommandDefinition<I, O extends object = object> {
  /** Checked by the server before the command runs. */
  capability: Capability;
  /** Validates a request body. The browser's input is already typed. */
  schema: z.ZodType<I>;
  run: (
    snapshot: ChurchSnapshot,
    input: I,
    ctx: CommandContext,
  ) => Result<CommandResult & O>;
}

function define<I, O extends object = object>(
  definition: CommandDefinition<I, O>,
): CommandDefinition<I, O> {
  return definition;
}

export const COMMANDS = {
  // --- Visitors -----------------------------------------------------------
  "visitor.register": define({
    capability: "visitors.write",
    schema: z.object({
      firstName: name,
      lastName: name,
      preferredName: z.string().trim().max(40).optional(),
      phone: z.string().max(32).optional(),
      email: z.string().max(200).optional(),
      visitDate: isoDate,
      sessionId: optionalId,
      source: enumOf(VISITOR_SOURCES),
      assignedTo: optionalId,
      preferredMethod: contactMethod,
      permissionGranted: z.boolean(),
      interests: z.array(z.string().max(60)).optional(),
      notes: shortText.optional(),
      selfRegistered: z.boolean().optional(),
      returningVisitor: z.boolean().optional(),
    }),
    run: registerVisitor,
  }),

  "visitor.recordReturnVisit": define({
    capability: "attendance.write",
    schema: z.object({ personId: id, sessionId: id }),
    run: (snapshot, input, ctx) =>
      recordReturnVisit(snapshot, input.personId, input.sessionId, ctx),
  }),

  "visitor.assign": define({
    capability: "tasks.assign",
    schema: z.object({ personId: id, assigneeId: optionalId }),
    run: (snapshot, input, ctx) =>
      assignVisitor(snapshot, input.personId, input.assigneeId, ctx),
  }),

  "visitor.setStage": define({
    capability: "visitors.write",
    schema: z.object({ personId: id, stageId: id }),
    run: (snapshot, input, ctx) => setStage(snapshot, input.personId, input.stageId, ctx),
  }),

  "visitor.closeFollowUp": define({
    capability: "tasks.write",
    schema: z.object({
      personId: id,
      reason: closureReason,
      note: shortText.optional(),
      optOut: z.boolean().optional(),
    }),
    run: closeFollowUp,
  }),

  "visitor.setContactPreferences": define({
    capability: "people.write",
    schema: z.object({
      personId: id,
      preferredMethod: contactMethod.optional(),
      permissionGranted: z.boolean().optional(),
      optedOut: z.boolean().optional(),
      optOutReason: shortText.optional(),
    }),
    run: setContactPreferences,
  }),

  "visitor.recordMembershipInterest": define({
    capability: "visitors.write",
    schema: z.object({ personId: id }),
    run: (snapshot, input, ctx) => recordMembershipInterest(snapshot, input.personId, ctx),
  }),

  // --- Follow-up tasks ----------------------------------------------------
  "task.create": define({
    capability: "tasks.write",
    schema: z.object({
      personId: id,
      type: enumOf(FOLLOW_UP_TASK_TYPES),
      assigneeId: optionalId,
      dueDate: isoDate.optional(),
      priority: enumOf(TASK_PRIORITIES).optional(),
      notes: shortText.optional(),
    }),
    // `origin` and `automationKey` are deliberately not accepted from a
    // client: those belong to the automation engine, and letting a request set
    // them would let it forge or block a generated task.
    run: createFollowUpTask,
  }),

  "task.complete": define({
    capability: "tasks.write",
    schema: z.object({
      taskId: id,
      outcome: enumOf(TASK_OUTCOMES),
      outcomeNote: shortText.optional(),
    }),
    run: completeTask,
  }),

  "task.reschedule": define({
    capability: "tasks.write",
    schema: z.object({ taskId: id, dueDate: isoDate, reason: shortText.optional() }),
    run: (snapshot, input, ctx) =>
      rescheduleTask(snapshot, input.taskId, input.dueDate, input.reason, ctx),
  }),

  "task.assign": define({
    capability: "tasks.assign",
    schema: z.object({ taskId: id, assigneeId: optionalId }),
    run: (snapshot, input, ctx) =>
      assignTask(snapshot, input.taskId, input.assigneeId, ctx),
  }),

  "task.start": define({
    capability: "tasks.write",
    schema: z.object({ taskId: id }),
    run: (snapshot, input) => startTask(snapshot, input.taskId),
  }),

  "task.cancel": define({
    capability: "tasks.write",
    schema: z.object({ taskId: id, reason: shortText.optional() }),
    run: (snapshot, input, ctx) => cancelTask(snapshot, input.taskId, input.reason, ctx),
  }),

  // --- Members and people -------------------------------------------------
  "member.register": define({
    capability: "people.write",
    schema: z.object({
      personId: optionalId,
      firstName: name.optional(),
      lastName: name.optional(),
      preferredName: z.string().trim().max(40).optional(),
      phone: z.string().max(32).optional(),
      email: z.string().max(200).optional(),
      membershipDate: isoDate,
      preferredServiceType: z.string().max(60).optional(),
      preferredMethod: contactMethod.optional(),
      permissionGranted: z.boolean().optional(),
      householdId: optionalId,
    }),
    run: registerMember,
  }),

  "member.changeStatus": define({
    capability: "people.write",
    schema: z.object({
      personId: id,
      status: enumOf(MEMBERSHIP_STATUSES),
      reason: shortText.optional(),
    }),
    run: (snapshot, input, ctx) =>
      changeMembershipStatus(snapshot, input.personId, input.status, input.reason, ctx),
  }),

  "member.recordOrientationCompleted": define({
    capability: "people.write",
    schema: z.object({ personId: id }),
    run: (snapshot, input, ctx) =>
      recordOrientationCompleted(snapshot, input.personId, ctx),
  }),

  "member.setEmergencyContact": define({
    capability: "people.write",
    schema: z.object({
      personId: id,
      contact: z
        .object({
          name: name,
          relationship: z.string().trim().min(1).max(60),
          phone: z.string().trim().min(1).max(32),
        })
        .optional(),
    }),
    run: (snapshot, input, ctx) =>
      setEmergencyContact(snapshot, input.personId, input.contact, ctx),
  }),

  "member.setRequestedContact": define({
    capability: "people.write",
    schema: z.object({ personId: id, requested: z.boolean() }),
    run: (snapshot, input, ctx) =>
      setRequestedContact(snapshot, input.personId, input.requested, ctx),
  }),

  "person.correct": define({
    capability: "people.write",
    schema: z.object({
      personId: id,
      changes: z.object({
        firstName: name.optional(),
        lastName: name.optional(),
        preferredName: z.string().trim().max(40).optional(),
        phone: z.string().max(32).optional(),
        email: z.string().max(200).optional(),
        ageGroup: ageGroup.optional(),
        interests: z.array(z.string().max(60)).optional(),
        householdId: id.nullable().optional(),
        notes: shortText.optional(),
      }),
    }),
    run: (snapshot, input, ctx) =>
      correctPerson(snapshot, input.personId, input.changes, ctx),
  }),

  "person.delete": define({
    capability: "people.write",
    schema: z.object({ personId: id, reason: shortText.optional() }),
    run: (snapshot, input, ctx) => deletePerson(snapshot, input.personId, input.reason, ctx),
  }),

  "person.setHousehold": define({
    capability: "people.write",
    // Accepts null as well as an omitted key, because a client clearing a
    // household will naturally send one or the other.
    schema: z.object({ personId: id, householdId: id.nullish() }),
    run: (snapshot, input, ctx) =>
      setHousehold(snapshot, input.personId, input.householdId ?? undefined, ctx),
  }),

  "household.create": define({
    capability: "people.write",
    schema: z.object({
      name: name,
      area: z.string().trim().max(80).optional(),
      primaryContactId: optionalId,
    }),
    run: createHousehold,
  }),

  // --- Attendance ---------------------------------------------------------
  "session.create": define({
    capability: "attendance.write",
    schema: z.object({
      name: name,
      date: isoDate,
      startTime: timeOfDay,
      type: enumOf(SERVICE_TYPES),
      groupId: optionalId,
      notes: shortText.optional(),
    }),
    run: createSession,
  }),

  "session.updateNotes": define({
    capability: "attendance.write",
    schema: z.object({ sessionId: id, notes: shortText }),
    run: (snapshot, input) => updateSessionNotes(snapshot, input.sessionId, input.notes),
  }),

  "attendance.record": define({
    capability: "attendance.write",
    schema: z.object({ sessionId: id, personId: id, method: checkInMethod.optional() }),
    run: recordAttendance,
  }),

  "attendance.remove": define({
    capability: "attendance.write",
    schema: z.object({ recordId: id, reason: shortText.optional() }),
    run: (snapshot, input, ctx) =>
      removeAttendance(snapshot, input.recordId, input.reason, ctx),
  }),

  "attendance.move": define({
    capability: "attendance.write",
    schema: z.object({ recordId: id, toSessionId: id, reason: shortText.optional() }),
    run: (snapshot, input, ctx) =>
      moveAttendance(snapshot, input.recordId, input.toSessionId, input.reason, ctx),
  }),

  "attendance.importCsv": define({
    capability: "attendance.write",
    schema: z.object({ sessionId: id, csv: z.string().max(1_000_000) }),
    run: (snapshot, input, ctx) =>
      importAttendanceCsv(snapshot, input.sessionId, input.csv, ctx),
  }),

  // --- Groups -------------------------------------------------------------
  "group.create": define({
    capability: "groups.write",
    schema: z.object({
      name: name,
      description: shortText,
      type: enumOf(GROUP_TYPES),
      leaderId: optionalId,
      schedule: z
        .object({
          weekday: enumOf(WEEKDAYS),
          time: timeOfDay,
          frequency: z.enum(["weekly", "fortnightly", "monthly"]),
        })
        .optional(),
      location: z.string().trim().max(120).optional(),
      involvesMinors: z.boolean().optional(),
    }),
    run: createGroup,
  }),

  "group.addMember": define({
    capability: "groups.write",
    schema: z.object({
      groupId: id,
      personId: id,
      role: z.enum(["member", "leader", "assistant"]).optional(),
    }),
    run: (snapshot, input, ctx) =>
      addGroupMember(snapshot, input.groupId, input.personId, input.role, ctx),
  }),

  "group.removeMember": define({
    capability: "groups.write",
    schema: z.object({ groupId: id, personId: id }),
    run: (snapshot, input, ctx) =>
      removeGroupMember(snapshot, input.groupId, input.personId, ctx),
  }),

  "group.setLeader": define({
    capability: "groups.write",
    schema: z.object({ groupId: id, personId: id }),
    run: (snapshot, input, ctx) =>
      setGroupLeader(snapshot, input.groupId, input.personId, ctx),
  }),

  "group.setActive": define({
    capability: "groups.write",
    schema: z.object({ groupId: id, active: z.boolean() }),
    run: (snapshot, input) => setGroupActive(snapshot, input.groupId, input.active),
  }),

  // --- Communications -----------------------------------------------------
  "communication.log": define({
    capability: "communications.write",
    schema: z.object({
      personId: id,
      templateId: optionalId,
      taskId: optionalId,
      channel: contactMethod,
      status: communicationStatus,
      body: z.string().max(5_000),
    }),
    run: logCommunication,
  }),

  "template.create": define({
    capability: "communications.write",
    schema: z.object({
      name: name,
      category: templateCategory,
      channels: z.array(contactMethod).min(1),
      body: z.string().min(1).max(5_000),
    }),
    run: createTemplate,
  }),

  "template.update": define({
    capability: "communications.write",
    schema: z.object({
      templateId: id,
      input: z.object({
        name: name,
        category: templateCategory,
        channels: z.array(contactMethod).min(1),
        body: z.string().min(1).max(5_000),
      }),
    }),
    run: (snapshot, input, ctx) =>
      updateTemplate(snapshot, input.templateId, input.input, ctx),
  }),

  "template.delete": define({
    capability: "communications.write",
    schema: z.object({ templateId: id }),
    run: (snapshot, input) => deleteTemplate(snapshot, input.templateId),
  }),

  // --- Pastoral care (restricted) -----------------------------------------
  "care.create": define({
    capability: "care.write",
    schema: z.object({
      personId: id,
      category: careCategory,
      summary: z.string().trim().min(1).max(500),
      assigneeId: optionalId,
      receivedAt: isoDate,
      nextAction: shortText.optional(),
      nextActionDate: isoDate.optional(),
      note: shortText.optional(),
    }),
    run: createCareRecord,
  }),

  "care.update": define({
    capability: "care.write",
    schema: z.object({
      recordId: id,
      changes: z.object({
        status: enumOf(CARE_STATUSES).optional(),
        assigneeId: optionalId,
        nextAction: shortText.optional(),
        nextActionDate: isoDate.optional(),
      }),
    }),
    run: (snapshot, input, ctx) =>
      updateCareRecord(snapshot, input.recordId, input.changes, ctx),
  }),

  "care.addNote": define({
    capability: "care.write",
    schema: z.object({ recordId: id, text: z.string().trim().min(1).max(2_000) }),
    run: (snapshot, input, ctx) => addCareNote(snapshot, input.recordId, input.text, ctx),
  }),

  "care.scheduleAppointment": define({
    capability: "care.write",
    schema: z.object({
      recordId: id,
      input: z.object({
        date: isoDate,
        time: timeOfDay,
        location: z.string().trim().max(120).optional(),
      }),
    }),
    run: (snapshot, input, ctx) =>
      scheduleCareAppointment(snapshot, input.recordId, input.input, ctx),
  }),

  "care.setAppointmentStatus": define({
    capability: "care.write",
    schema: z.object({
      recordId: id,
      appointmentId: id,
      status: z.enum(["scheduled", "completed", "cancelled"]),
    }),
    run: (snapshot, input, ctx) =>
      setAppointmentStatus(snapshot, input.recordId, input.appointmentId, input.status, ctx),
  }),

  // --- Settings -----------------------------------------------------------
  "settings.updateProfile": define({
    capability: "settings.write",
    schema: z.object({
      churchName: name.optional(),
      timezoneLabel: z.string().trim().max(60).optional(),
      defaultFollowUpDueInDays: z.number().int().min(0).max(90).optional(),
    }),
    run: (snapshot, input) => updateChurchProfile(snapshot, input),
  }),

  "settings.updateAutomationRule": define({
    capability: "settings.write",
    schema: z.object({
      id: enumOf(AUTOMATION_RULE_IDS),
      changes: z.object({
        enabled: z.boolean().optional(),
        dueInDays: z.number().int().min(0).max(90).optional(),
        defaultAssigneeId: optionalId,
      }),
    }),
    run: (snapshot, input) => updateAutomationRule(snapshot, input.id, input.changes),
  }),

  "settings.updateEngagement": define({
    capability: "settings.write",
    schema: z.object({
      inactiveAfterWeeksAbsent: z.number().int().min(1).max(52).optional(),
      attendanceAverageWeeks: z.number().int().min(1).max(52).optional(),
      maxContactAttempts: z.number().int().min(1).max(10).optional(),
    }),
    run: (snapshot, input) => updateEngagementCriteria(snapshot, input),
  }),

  "settings.updatePipelineStages": define({
    capability: "settings.write",
    schema: z.object({
      stages: z.array(
        z.object({
          id: id,
          name: name,
          description: shortText.optional(),
          order: z.number().int(),
          kind: z.enum(["active", "terminal"]),
          suggestedAction: shortText.optional(),
        }),
      ),
    }),
    run: (snapshot, input) => updatePipelineStages(snapshot, input.stages),
  }),

  "settings.updateServices": define({
    capability: "settings.write",
    schema: z.object({
      services: z.array(
        z.object({
          id: id,
          name: name,
          type: enumOf(SERVICE_TYPES),
          weekday: enumOf(WEEKDAYS),
          time: timeOfDay,
          active: z.boolean(),
        }),
      ),
    }),
    run: (snapshot, input) => updateServices(snapshot, input.services),
  }),

  "settings.upsertTeamMember": define({
    capability: "settings.write",
    schema: z.object({
      id: optionalId,
      name: name,
      role: enumOf(DEMO_ROLES),
      title: z.string().trim().max(80).optional(),
      active: z.boolean().optional(),
    }),
    run: upsertTeamMember,
  }),

  "settings.setTeamMemberActive": define({
    capability: "settings.write",
    schema: z.object({ teamMemberId: id, active: z.boolean() }),
    run: (snapshot, input) =>
      setTeamMemberActive(snapshot, input.teamMemberId, input.active),
  }),
} as const;

export type CommandName = keyof typeof COMMANDS;

/** The input a given command takes. */
export type CommandInput<N extends CommandName> =
  (typeof COMMANDS)[N] extends CommandDefinition<infer I, object> ? I : never;

/** The extra payload a given command reports, beyond the snapshot. */
export type CommandOutput<N extends CommandName> =
  (typeof COMMANDS)[N] extends CommandDefinition<never, infer O> ? O : object;

export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

export function isCommandName(value: unknown): value is CommandName {
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a request
  // naming "__proto__", "constructor" or "toString" would be accepted as a
  // command and then have `.schema` read off `Object.prototype`.
  return typeof value === "string" && Object.hasOwn(COMMANDS, value);
}

/**
 * Looks up a command whose name is only known at runtime.
 *
 * Indexing `COMMANDS` with a variable produces a union of all 49 definitions,
 * and the type system cannot see that a given entry's `schema` and `run` refer
 * to the *same* input — so it rejects passing one to the other. The registry
 * does guarantee it: `define` ties them together at every call site, and the
 * schema is what produces the value `run` receives.
 *
 * This is the single place that widens the input to `unknown`, which is what
 * it genuinely is before the schema has parsed it.
 */
export function commandFor(name: CommandName): CommandDefinition<unknown, object> {
  return COMMANDS[name] as unknown as CommandDefinition<unknown, object>;
}
