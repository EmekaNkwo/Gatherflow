/**
 * Shared primitives used across the GatherFlow domain.
 *
 * All timestamps are stored as ISO-8601 strings so that the persisted
 * snapshot stays JSON-serialisable and human readable in devtools.
 */

/** ISO-8601 instant, e.g. `2026-10-12T09:30:00.000Z`. */
export type IsoDateTime = string;

/** Calendar day in `YYYY-MM-DD` form, used where time-of-day is irrelevant. */
export type IsoDate = string;

export type PersonId = string;
export type TaskId = string;
export type SessionId = string;
export type GroupId = string;
export type HouseholdId = string;
export type TeamMemberId = string;
export type CareRecordId = string;
export type TemplateId = string;
export type StageId = string;

export type ContactMethod = "phone" | "sms" | "whatsapp" | "email" | "in_person";

export const CONTACT_METHODS: readonly ContactMethod[] = [
  "phone",
  "sms",
  "whatsapp",
  "email",
  "in_person",
];

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  phone: "Phone call",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  in_person: "In person",
};

/**
 * Visibility marker for activity entries and notes. `restricted` content is
 * hidden from general dashboards, exports and global search.
 */
export type Visibility = "general" | "restricted";

export interface DateRange {
  /** Inclusive start of the range. */
  from: IsoDate;
  /** Inclusive end of the range. */
  to: IsoDate;
}

/** A count-based metric that always carries its denominator. */
export interface Ratio {
  numerator: number;
  denominator: number;
  /** `null` when the denominator is zero — never silently reported as 0%. */
  percentage: number | null;
}
