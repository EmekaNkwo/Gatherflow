import type { PersonId, TaskId, TemplateId } from "./common";

/**
 * Email, as the interface sees it. Shared by both sides so the browser and
 * the server describe the same thing with the same words.
 */

/** Whether the interface may offer to send, decided by the server. */
export interface EmailAvailability {
  /** Provider credentials exist. */
  configured: boolean;
  /** The production gate is open: sending is actually offered. */
  enabled: boolean;
  /** A pilot allowlist is in force; most addresses will be refused. */
  pilot: boolean;
  reason?: string;
}

export const EMAIL_UNAVAILABLE: EmailAvailability = {
  configured: false,
  enabled: false,
  pilot: false,
  reason: "This browser-only mode never sends anything.",
};

export interface SendEmailRequest {
  personId: PersonId;
  templateId: TemplateId;
  taskId?: TaskId;
  subject?: string;
  /** The message as finally worded; sent instead of the rendered template. */
  body?: string;
  serviceName?: string;
  serviceDate?: string;
  groupName?: string;
}

export interface SendEmailReceipt {
  communicationId: string;
  outboxId: string;
  toEmail: string;
}
