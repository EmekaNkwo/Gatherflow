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
 * What actually happened with a message.
 *
 * Two groups, and the distinction matters. The *manual* statuses describe what
 * a person did with a draft — copied it, opened it in their own messaging app
 * — because the application handed it over and cannot know any more than
 * that. The *email* statuses describe a real send through a provider, and each
 * one corresponds to something the provider actually told us — none is inferred.
 *
 * `sent` means our provider accepted the request. `delivered` means the
 * receiving mail server accepted the message, which is the strongest claim
 * available: Mailjet reports it as its `sent` event, and there is no later
 * "the human read it" signal that could honestly be recorded.
 */
export type ManualCommunicationStatus = "drafted" | "copied" | "opened_external";

export type EmailCommunicationStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "blocked"
  | "spam"
  | "unsubscribed"
  | "failed";

export type CommunicationStatus = ManualCommunicationStatus | EmailCommunicationStatus;

/** The statuses a person's own action can produce; the rest are the server's. */
export const MANUAL_COMMUNICATION_STATUSES: readonly ManualCommunicationStatus[] = [
  "drafted",
  "copied",
  "opened_external",
];

export const EMAIL_COMMUNICATION_STATUSES: readonly EmailCommunicationStatus[] = [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "blocked",
  "spam",
  "unsubscribed",
  "failed",
];

export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> = {
  drafted: "Draft prepared",
  copied: "Copied to clipboard",
  opened_external: "Opened in your messaging app",
  queued: "Queued to send",
  sent: "Sent to the provider",
  delivered: "Delivered to their mail server",
  bounced: "Bounced",
  blocked: "Blocked by their mail server",
  spam: "Reported as spam",
  unsubscribed: "Unsubscribed",
  failed: "Could not be sent",
};

/** Statuses that end the attempt: nothing further will happen. */
export const TERMINAL_EMAIL_STATUSES: readonly EmailCommunicationStatus[] = [
  "delivered",
  "bounced",
  "blocked",
  "spam",
  "unsubscribed",
  "failed",
];

/**
 * Statuses that mean nobody was reached: a saved draft, or an email that
 * never left. These do not count towards the church's contact limit.
 */
export const NON_CONTACT_STATUSES: readonly CommunicationStatus[] = [
  "drafted",
  "failed",
  "bounced",
  "blocked",
];

export function countsAsContact(status: CommunicationStatus): boolean {
  return !NON_CONTACT_STATUSES.includes(status);
}

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
  /**
   * `true` when the application itself sent nothing — a draft, a copy, or a
   * hand-over to the person's own messaging app. A real provider send records
   * `false`, and the interface labels the two differently so a reader is
   * never misled about what happened.
   */
  simulated: boolean;
}
