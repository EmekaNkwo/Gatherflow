import type {
  ContactMethod,
  GroupId,
  HouseholdId,
  IsoDate,
  IsoDateTime,
  PersonId,
  SessionId,
  StageId,
  TeamMemberId,
} from "./common";

/**
 * A person is stored once and keeps the same id for life. Visitor and member
 * data live in optional profiles, so a visitor who later joins the church
 * keeps their attendance history, tasks and timeline.
 */
export type PersonKind = "visitor" | "member";

export type VisitorSource =
  | "walk_in"
  | "invitation"
  | "church_event"
  | "online"
  | "social_media"
  | "outreach";

export const VISITOR_SOURCES: readonly VisitorSource[] = [
  "walk_in",
  "invitation",
  "church_event",
  "online",
  "social_media",
  "outreach",
];

export const VISITOR_SOURCE_LABELS: Record<VisitorSource, string> = {
  walk_in: "Walk-in",
  invitation: "Friend or family invitation",
  church_event: "Church event",
  online: "Online discovery",
  social_media: "Social media",
  outreach: "Community outreach",
};

export type MembershipStatus =
  | "new_member"
  | "active"
  | "inactive"
  | "transferred"
  | "archived";

export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = [
  "new_member",
  "active",
  "inactive",
  "transferred",
  "archived",
];

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  new_member: "New member",
  active: "Active",
  inactive: "Inactive",
  transferred: "Transferred",
  archived: "Archived",
};

/** Why a visitor record is no longer being actively worked. */
export type ClosureReason =
  | "paused"
  | "contact_later"
  | "contact_declined"
  | "no_response"
  | "referred"
  | "closed";

export const CLOSURE_REASON_LABELS: Record<ClosureReason, string> = {
  paused: "Follow-up paused",
  contact_later: "Contact requested later",
  contact_declined: "Contact declined",
  no_response: "No response after agreed attempts",
  referred: "Referred to another team",
  closed: "Closed",
};

/**
 * Consent is recorded explicitly. `optedOut` always wins over any other
 * preference, and communication services refuse to draft messages for it.
 */
export interface ContactPreferences {
  preferredMethod: ContactMethod;
  /** The person agreed to be contacted about the church. */
  permissionGranted: boolean;
  optedOut: boolean;
  optedOutAt?: IsoDateTime;
  optOutReason?: string;
  /** Hard stop on repeated attempts; defaults come from church settings. */
  maxContactAttempts?: number;
}

export interface VisitorProfile {
  firstVisitDate: IsoDate;
  source: VisitorSource;
  /** Session the person first attended, when known. */
  firstSessionId?: SessionId;
  assignedTo?: TeamMemberId;
  stageId: StageId;
  stageUpdatedAt: IsoDateTime;
  lastContactAt?: IsoDateTime;
  contactAttempts: number;
  /** Set when the visitor asks about membership. */
  membershipInterestAt?: IsoDateTime;
  /**
   * The visitor told us they had been before they were registered. Counts as
   * one earlier, undated visit, so they are never shown as first-time.
   */
  returningVisitor?: boolean;
  closure?: {
    reason: ClosureReason;
    note?: string;
    recordedAt: IsoDateTime;
  };
  notes?: string;
}

export interface MembershipStatusChange {
  status: MembershipStatus;
  changedAt: IsoDateTime;
  changedBy: TeamMemberId;
  reason?: string;
}

/** Restricted: only surfaced to roles with the `care.read` capability. */
export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface MemberProfile {
  /** Human-facing reference such as `MEM-0042`. */
  reference: string;
  status: MembershipStatus;
  membershipDate: IsoDate;
  preferredServiceType?: string;
  statusHistory: readonly MembershipStatusChange[];
  emergencyContact?: EmergencyContact;
  /** True when the member has asked someone to get in touch. */
  requestedContact?: boolean;
}

export interface Person {
  id: PersonId;
  kind: PersonKind;
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  /** Approximate age band — enough for ministry assignment, no birthdates. */
  ageGroup?: "child" | "youth" | "adult";
  householdId?: HouseholdId;
  interests: readonly string[];
  groupIds: readonly GroupId[];
  contact: ContactPreferences;
  visitor?: VisitorProfile;
  member?: MemberProfile;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Household {
  id: HouseholdId;
  name: string;
  /** Area or district only — no full street addresses in the demo data. */
  area?: string;
  primaryContactId?: PersonId;
  createdAt: IsoDateTime;
}
