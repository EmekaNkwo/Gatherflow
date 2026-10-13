import type {
  ContactMethod,
  IsoDateTime,
  PersonId,
  TaskId,
  TemplateId,
  TeamMemberId,
} from "./common";

export type TemplateCategory =
  | "visitor_welcome"
  | "thank_you"
  | "service_invitation"
  | "post_event"
  | "membership_orientation"
  | "group_invitation"
  | "general_check_in";

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  visitor_welcome: "First-time visitor welcome",
  thank_you: "Thank you for attending",
  service_invitation: "Invitation to a service",
  post_event: "Follow-up after an event",
  membership_orientation: "Membership orientation",
  group_invitation: "Connect-group invitation",
  general_check_in: "General check-in",
};

/** Placeholders the template engine knows how to resolve. */
export type TemplatePlaceholder =
  | "firstName"
  | "preferredName"
  | "churchName"
  | "serviceDate"
  | "serviceName"
  | "senderName"
  | "groupName";

export const TEMPLATE_PLACEHOLDERS: readonly TemplatePlaceholder[] = [
  "firstName",
  "preferredName",
  "churchName",
  "serviceDate",
  "serviceName",
  "senderName",
  "groupName",
];

export interface MessageTemplate {
  id: TemplateId;
  name: string;
  category: TemplateCategory;
  /** Channels this wording suits; used to filter template suggestions. */
  channels: readonly ContactMethod[];
  body: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Built-in templates can be edited but not deleted. */
  builtIn: boolean;
}

/**
 * What actually happened with a message. The application can never confirm
 * external delivery, so there is deliberately no `delivered` state.
 */
export type CommunicationStatus =
  | "drafted"
  | "copied"
  | "opened_external"
  | "simulated_sent";

export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> = {
  drafted: "Draft prepared",
  copied: "Copied to clipboard",
  opened_external: "Opened in external app",
  simulated_sent: "Simulated send",
};

export interface CommunicationLogEntry {
  id: string;
  personId: PersonId;
  templateId?: TemplateId;
  taskId?: TaskId;
  channel: ContactMethod;
  status: CommunicationStatus;
  body: string;
  at: IsoDateTime;
  actorId: TeamMemberId;
  /** Always true in this portfolio build; rendered as an explicit badge. */
  simulated: true;
}
