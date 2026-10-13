import type {
  CareRecordId,
  IsoDate,
  IsoDateTime,
  PersonId,
  TeamMemberId,
} from "./common";

/**
 * Pastoral care deliberately keeps only a coarse category and short,
 * explicitly restricted notes. No medical, financial or other highly
 * sensitive detail is modelled.
 */
export type CareCategory =
  | "prayer_request"
  | "hospital_visit"
  | "bereavement"
  | "practical_support"
  | "counselling_request"
  | "new_parent"
  | "other";

export const CARE_CATEGORY_LABELS: Record<CareCategory, string> = {
  prayer_request: "Prayer request",
  hospital_visit: "Hospital or home visit",
  bereavement: "Bereavement support",
  practical_support: "Practical support",
  counselling_request: "Counselling request",
  new_parent: "New parent support",
  other: "Other",
};

export type CareStatus =
  | "new"
  | "assigned"
  | "in_progress"
  | "awaiting_response"
  | "resolved"
  | "closed";

export const CARE_STATUSES: readonly CareStatus[] = [
  "new",
  "assigned",
  "in_progress",
  "awaiting_response",
  "resolved",
  "closed",
];

export const CARE_STATUS_LABELS: Record<CareStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  awaiting_response: "Awaiting response",
  resolved: "Resolved",
  closed: "Closed",
};

export interface CareNote {
  at: IsoDateTime;
  by: TeamMemberId;
  text: string;
  /** Always restricted — excluded from exports and general activity feeds. */
  visibility: "restricted";
}

export interface CareAppointment {
  id: string;
  date: IsoDate;
  /** Local time in `HH:mm`. */
  time: string;
  /** General location only, e.g. "Church office". */
  location?: string;
  status: "scheduled" | "completed" | "cancelled";
}

export interface CareRecord {
  id: CareRecordId;
  reference: string;
  personId: PersonId;
  category: CareCategory;
  /** Short, non-sensitive description of the request. */
  summary: string;
  assigneeId?: TeamMemberId;
  receivedAt: IsoDate;
  nextAction?: string;
  nextActionDate?: IsoDate;
  status: CareStatus;
  notes: readonly CareNote[];
  appointments: readonly CareAppointment[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
