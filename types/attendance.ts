import type {
  GroupId,
  IsoDate,
  IsoDateTime,
  PersonId,
  SessionId,
  TeamMemberId,
} from "./common";

export type ServiceType =
  | "sunday_service"
  | "midweek_service"
  | "prayer_meeting"
  | "youth_gathering"
  | "special_event"
  | "group_meeting";

export const SERVICE_TYPES: readonly ServiceType[] = [
  "sunday_service",
  "midweek_service",
  "prayer_meeting",
  "youth_gathering",
  "special_event",
  "group_meeting",
];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  sunday_service: "Sunday service",
  midweek_service: "Midweek service",
  prayer_meeting: "Prayer meeting",
  youth_gathering: "Youth gathering",
  special_event: "Special event",
  group_meeting: "Group meeting",
};

export interface AttendanceSession {
  id: SessionId;
  name: string;
  date: IsoDate;
  /** Local start time in `HH:mm`. */
  startTime: string;
  type: ServiceType;
  /** Set for group or ministry meetings. */
  groupId?: GroupId;
  notes?: string;
  createdAt: IsoDateTime;
}

export type CheckInMethod =
  | "search"
  | "manual"
  | "new_visitor"
  | "csv_import"
  | "qr_demo"
  | "self_registration";

export const CHECK_IN_METHOD_LABELS: Record<CheckInMethod, string> = {
  search: "Searched and selected",
  manual: "Manual check-in",
  new_visitor: "Added during check-in",
  csv_import: "CSV import",
  qr_demo: "QR check-in (demo)",
  self_registration: "Self-registration",
};

export interface AttendanceCorrection {
  at: IsoDateTime;
  by: TeamMemberId;
  action: "removed" | "restored" | "moved_session";
  reason?: string;
  /** Previous session id, when the record was moved. */
  previousSessionId?: SessionId;
}

export interface AttendanceRecord {
  id: string;
  sessionId: SessionId;
  personId: PersonId;
  method: CheckInMethod;
  /** `removed` records are retained so corrections keep an audit trail. */
  status: "present" | "removed";
  recordedAt: IsoDateTime;
  recordedBy: TeamMemberId;
  /** True when this was the person's first recorded attendance. */
  firstVisit: boolean;
  corrections: readonly AttendanceCorrection[];
}

export interface AttendanceTrendPoint {
  /** Monday of the ISO week. */
  weekStart: IsoDate;
  label: string;
  total: number;
  members: number;
  visitors: number;
  firstTimeVisitors: number;
}
