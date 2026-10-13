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
