import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import type { DemoRole } from "@/types/team";
import type { ActivityEvent } from "@/types/activity";
import type { AttendanceRecord, AttendanceSession } from "@/types/attendance";
import type { CareRecord } from "@/types/care";
import type { CommunicationLogEntry, MessageTemplate } from "@/types/communication";
import type { FollowUpTask } from "@/types/follow-up";
import type { Group } from "@/types/group";
import type { Household, Person } from "@/types/person";
import type { ChurchSettings } from "@/types/settings";
import type { TeamMember } from "@/types/team";

/**
 * Database schema.
 *
 * Each record is stored whole in a `data` jsonb column, validated on read by
 * the same Zod schemas the browser build uses (`services/repositories/schema`).
 * One definition of shape, one place it can drift.
 *
 * Alongside `data`, a small set of columns is *promoted* out of the record:
 * the ones the database needs in order to enforce an invariant or to answer a
 * query without loading the whole church. They are derived from the record on
 * write (see `promote` in `snapshot-repository.ts`), never set independently,
 * so they cannot disagree with `data`.
 *
 * This suits an application whose access pattern is "load one church"; it is
 * deliberately not a fully normalised schema. When server-side filtering and
 * pagination arrive, more columns get promoted — the records themselves do not
 * have to move.
 */

/**
 * The tenant, and the unit of optimistic concurrency.
 *
 * `version` increments on every successful commit. A writer states the version
 * it read, and a commit whose guard does not match is refused rather than
 * overwriting work it never saw.
 */
export const churches = pgTable("churches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  schemaVersion: integer("schema_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Church settings: a single document per church. */
export const churchSettings = pgTable("church_settings", {
  churchId: text("church_id")
    .primaryKey()
    .references(() => churches.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ChurchSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const churchId = () =>
  text("church_id")
    .notNull()
    .references(() => churches.id, { onDelete: "cascade" });

export const people = pgTable(
  "people",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    email: text("email"),
    phone: text("phone"),
    householdId: text("household_id"),
    // Promoted so a send path can check consent without loading the church.
    optedOut: boolean("opted_out").notNull(),
    permissionGranted: boolean("permission_granted").notNull(),
    data: jsonb("data").$type<Person>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    index("people_church_kind_idx").on(t.churchId, t.kind),
    index("people_church_email_idx").on(t.churchId, t.email),
  ],
);

export const households = pgTable(
  "households",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    data: jsonb("data").$type<Household>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.churchId, t.id] })],
);

export const groups = pgTable(
  "groups",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    active: boolean("active").notNull(),
    involvesMinors: boolean("involves_minors").notNull(),
    data: jsonb("data").$type<Group>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.churchId, t.id] })],
);

export const tasks = pgTable(
  "tasks",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    personId: text("person_id").notNull(),
    assigneeId: text("assignee_id"),
    status: text("status").notNull(),
    dueDate: text("due_date").notNull(),
    automationKey: text("automation_key"),
    data: jsonb("data").$type<FollowUpTask>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    // The idempotency guarantee, moved from memory into the database. The
    // application already refuses a duplicate automationKey; this makes it
    // true even when two server instances process the same event at once.
    uniqueIndex("tasks_automation_key_unique")
      .on(t.churchId, t.automationKey)
      .where(sql`automation_key is not null`),
    index("tasks_church_status_due_idx").on(t.churchId, t.status, t.dueDate),
    index("tasks_church_assignee_idx").on(t.churchId, t.assigneeId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    date: text("date").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").$type<AttendanceSession>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    index("sessions_church_date_idx").on(t.churchId, t.date),
  ],
);

export const attendance = pgTable(
  "attendance",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    sessionId: text("session_id").notNull(),
    personId: text("person_id").notNull(),
    status: text("status").notNull(),
    data: jsonb("data").$type<AttendanceRecord>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    // Check-in restores a removed record rather than inserting a second one,
    // so one row per person per session is an invariant worth enforcing here.
    uniqueIndex("attendance_session_person_unique").on(t.churchId, t.sessionId, t.personId),
    index("attendance_church_person_idx").on(t.churchId, t.personId),
  ],
);

/**
 * Pastoral care. Restricted: kept in its own table so access can be granted
 * separately from the rest of the church, and so it is impossible to include
 * by accident in a query that selects "everything about a person".
 */
export const careRecords = pgTable(
  "care_records",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    personId: text("person_id").notNull(),
    assigneeId: text("assignee_id"),
    status: text("status").notNull(),
    data: jsonb("data").$type<CareRecord>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    index("care_church_status_idx").on(t.churchId, t.status),
  ],
);

export const templates = pgTable(
  "templates",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    category: text("category").notNull(),
    builtIn: boolean("built_in").notNull(),
    data: jsonb("data").$type<MessageTemplate>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.churchId, t.id] })],
);

export const communications = pgTable(
  "communications",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    personId: text("person_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    at: text("at").notNull(),
    data: jsonb("data").$type<CommunicationLogEntry>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    index("communications_church_person_at_idx").on(t.churchId, t.personId, t.at),
  ],
);

export const team = pgTable(
  "team",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    role: text("role").notNull(),
    active: boolean("active").notNull(),
    data: jsonb("data").$type<TeamMember>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.churchId, t.id] })],
);

export const activity = pgTable(
  "activity",
  {
    churchId: churchId(),
    id: text("id").notNull(),
    category: text("category").notNull(),
    visibility: text("visibility").notNull(),
    at: text("at").notNull(),
    data: jsonb("data").$type<ActivityEvent>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.id] }),
    // The dashboard feed reads general activity newest-first and must never
    // surface restricted entries; visibility leads the index.
    index("activity_church_visibility_at_idx").on(t.churchId, t.visibility, t.at),
  ],
);

/**
 * Membership of a church, and the authority on what someone may do.
 *
 * Better Auth answers "who is this?"; this table answers "what are they here?"
 * The role is read from this row on every request and is the only input to an
 * authorisation decision — a client cannot state its own role, which is the
 * whole difference between this and the browser-side role switcher.
 *
 * `teamMemberId` links the account to a row in `team`, so a command can record
 * who acted. It is deliberately *not* a foreign key: a team write replaces that
 * church's rows wholesale (see `writeCollection`), which a referencing
 * constraint would either block or cascade through. It is validated on read
 * instead.
 */
export const churchMembers = pgTable(
  "church_members",
  {
    churchId: churchId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<DemoRole>().notNull(),
    teamMemberId: text("team_member_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.userId] }),
    // One account per team member, so two people cannot act as the same
    // volunteer and make the attribution on a task meaningless.
    uniqueIndex("church_members_team_member_unique")
      .on(t.churchId, t.teamMemberId)
      .where(sql`team_member_id is not null`),
    index("church_members_user_idx").on(t.userId),
  ],
);

/**
 * The transactional outbox.
 *
 * A command that sends an email writes the communication record and a row here
 * in the *same* transaction. Nothing is handed to the provider during the
 * request: a worker drains this table afterwards. That ordering is what makes
 * the two facts inseparable — there is no window in which the provider has
 * accepted a message the church has no record of, or in which a record claims
 * a send that never left.
 *
 * `custom_id` goes to Mailjet as its CustomID and comes back on every webhook
 * event, which is how a provider report is matched to the row that caused it.
 * It is unique, so a retry of the same row cannot produce a second send.
 */
export const messageOutbox = pgTable(
  "message_outbox",
  {
    id: text("id").primaryKey(),
    churchId: churchId(),
    /** The `communications` record this send belongs to. */
    communicationId: text("communication_id").notNull(),
    personId: text("person_id").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    htmlPart: text("html_part").notNull(),
    textPart: text("text_part").notNull(),
    customId: text("custom_id").notNull().unique(),
    /** pending → sending → sent | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    mailjetMessageId: text("mailjet_message_id"),
    mailjetMessageUuid: text("mailjet_message_uuid"),
    /** Held by the worker that claimed the row, so two workers cannot race. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The worker's claim query: due, pending, oldest first.
    index("outbox_due_idx").on(t.status, t.nextAttemptAt),
    index("outbox_church_idx").on(t.churchId),
    index("outbox_communication_idx").on(t.communicationId),
  ],
);

/**
 * Addresses this church must not email again, and why.
 *
 * Scoped to the church because an unsubscribe is a statement about *this*
 * relationship, not about the mailbox. Mailjet keeps its own account-wide
 * exclusion list for genuinely dead addresses, so the two layers cover the
 * two different meanings between them.
 */
export const emailSuppression = pgTable(
  "email_suppression",
  {
    churchId: churchId(),
    email: text("email").notNull(),
    /** bounced | blocked | spam | unsubscribed */
    reason: text("reason").notNull(),
    detail: text("detail"),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.email] }),
    index("suppression_email_idx").on(t.email),
  ],
);

/**
 * Provider events already applied, so replaying one changes nothing.
 *
 * Mailjet does not sign its webhooks and will retry, so the endpoint has to
 * assume it may be called twice with the same event — or by somebody who
 * captured one.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    /** Deterministic from the event's own fields; see `eventKey`. */
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    event: text("event").notNull(),
    outboxId: text("outbox_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_events_outbox_idx").on(t.outboxId)],
);

/** Collection tables, keyed by the snapshot property they persist. */
export const collectionTables = {
  people,
  households,
  groups,
  tasks,
  sessions,
  attendance,
  careRecords,
  templates,
  communications,
  team,
  activity,
} as const;

export type CollectionTableName = keyof typeof collectionTables;

// Better Auth's own tables, generated by `npx auth generate` into
// auth-schema.ts. Re-exported here so one import gives the adapter and the
// migration tooling the whole schema.
export { account, session, user, verification } from "./auth-schema";
