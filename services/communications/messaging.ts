import { err, ok, type Result } from "@/lib/result";
import { toInternational } from "@/lib/phone";
import { displayName } from "@/lib/strings";
import type { ContactMethod, PersonId, TaskId, TemplateId } from "@/types/common";
import type { CommunicationLogEntry, CommunicationStatus } from "@/types/communication";
import { COMMUNICATION_STATUS_LABELS, countsAsContact } from "@/types/communication";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { activity, findPerson, patch, withActivity, withPerson } from "../core/snapshot";
import { renderTemplate } from "./template-engine";

export interface DraftMessageInput {
  personId: PersonId;
  templateId: TemplateId;
  channel?: ContactMethod;
  taskId?: TaskId;
  /** Group name for the connect-group invitation template. */
  groupName?: string;
  serviceName?: string;
  serviceDate?: string;
}

export interface MessageDraft {
  personId: PersonId;
  templateId: TemplateId;
  channel: ContactMethod;
  body: string;
  /** Placeholders that could not be filled; shown as a warning. */
  missing: string[];
  /**
   * No ready-made link lives here: the person may still edit the text, so the
   * link is built from the final words when they choose to open it
   * (`buildExternalLink`).
   */
  /** How many times this person has already been contacted this month. */
  recentContactCount: number;
  /** Set when the church's agreed contact limit has been reached. */
  limitWarning?: string;
}

/**
 * Prepares a message.
 *
 * Refuses outright when the person has opted out or never gave permission —
 * the draft does not even get created, so there is nothing to send by
 * accident.
 */
export function draftMessage(
  snapshot: ChurchSnapshot,
  input: DraftMessageInput,
  ctx: CommandContext,
): Result<MessageDraft> {
  const person = findPerson(snapshot, input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  if (person.contact.optedOut) {
    return err(
      `${displayName(person)} has opted out of contact. No message can be prepared.`,
      "opted_out",
    );
  }
  if (!person.contact.permissionGranted) {
    return err(
      `${displayName(person)} has not given permission to be contacted.`,
      "no_permission",
    );
  }

  const template = snapshot.templates.find((entry) => entry.id === input.templateId);
  if (!template) return err("That template no longer exists.", "not_found");

  const channel = input.channel ?? person.contact.preferredMethod;
  const sender = snapshot.team.find((member) => member.id === ctx.actorId);

  const rendered = renderTemplate(template.body, {
    person,
    churchName: snapshot.settings.churchName,
    senderName: sender?.name ?? "the church team",
    serviceDate: input.serviceDate ?? person.visitor?.firstVisitDate,
    serviceName: input.serviceName ?? "our Sunday service",
    groupName: input.groupName,
  });

  const monthAgo = new Date(ctx.now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Only real contact counts: a saved draft or an email that never left
  // has not reached anyone.
  const recentContactCount = snapshot.communications.filter(
    (entry) => entry.personId === person.id && entry.at >= monthAgo && countsAsContact(entry.status),
  ).length;

  const limit = person.contact.maxContactAttempts ?? snapshot.settings.engagement.maxContactAttempts;

  return ok({
    personId: person.id,
    templateId: template.id,
    channel,
    body: rendered.text,
    missing: rendered.missing,
    recentContactCount,
    limitWarning:
      recentContactCount >= limit
        ? `${displayName(person)} has already been contacted ${recentContactCount} times in the last 30 days. The church's agreed limit is ${limit}.`
        : undefined,
  });
}

/**
 * Builds a link the user chooses to open. Nothing is sent by the
 * application itself — these simply hand the message to an app the user
 * already has.
 *
 * WhatsApp needs the full international number; when the stored number can't
 * be read as one there is no link at all, never a guess.
 */
export function buildExternalLink(
  channel: ContactMethod,
  phone: string | undefined,
  email: string | undefined,
  body: string,
  countryCallingCode?: string,
): string | undefined {
  const encoded = encodeURIComponent(body);

  switch (channel) {
    case "whatsapp": {
      const international = toInternational(phone, countryCallingCode);
      return international ? `https://wa.me/${international}?text=${encoded}` : undefined;
    }
    case "sms":
      return phone ? `sms:${phone.replace(/\s/g, "")}?body=${encoded}` : undefined;
    case "email":
      return email ? `mailto:${email}?body=${encoded}` : undefined;
    case "phone":
      return phone ? `tel:${phone.replace(/\s/g, "")}` : undefined;
    case "in_person":
    default:
      return undefined;
  }
}

export interface LogCommunicationInput {
  personId: PersonId;
  templateId?: TemplateId;
  taskId?: TaskId;
  channel: ContactMethod;
  status: CommunicationStatus;
  body: string;
}

const CONTACT_LABEL: Partial<Record<ContactMethod, string>> = {
  whatsapp: "WhatsApp message",
  sms: "Text message",
  email: "Email",
  phone: "Phone call",
  in_person: "In-person note",
};

/** What the person who just acted reads back; short and natural. */
const LOGGED_NOTICE: Partial<Record<CommunicationStatus, string>> = {
  drafted: "Draft saved",
  copied: "Copied",
  opened_external: "Opened in your messaging app",
};

/**
 * Records what a person did with a draft. A manual status never claims
 * delivery: the application handed the text over and knows nothing more.
 */
export function logCommunication(
  snapshot: ChurchSnapshot,
  input: LogCommunicationInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const person = findPerson(snapshot, input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");
  if (person.contact.optedOut) {
    return err(`${displayName(person)} has opted out of contact.`, "opted_out");
  }
  if (!person.contact.permissionGranted) {
    return err(`${displayName(person)} has not given permission to be contacted.`, "no_permission");
  }

  const entry: CommunicationLogEntry = {
    id: ctx.id("comm"),
    personId: input.personId,
    templateId: input.templateId,
    taskId: input.taskId,
    channel: input.channel,
    status: input.status,
    body: input.body,
    at: ctx.nowIso,
    actorId: ctx.actorId,
    simulated: true,
  };

  let next = patch(snapshot, { communications: [...snapshot.communications, entry] });

  // Anything beyond a draft counts as reaching out, so the visitor record
  // shows when they were last contacted.
  if (input.status !== "drafted" && person.visitor) {
    next = withPerson(
      next,
      input.personId,
      (candidate) => ({
        ...candidate,
        visitor: candidate.visitor
          ? { ...candidate.visitor, lastContactAt: ctx.nowIso }
          : candidate.visitor,
      }),
      ctx,
    );
  }

  return ok(
    result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "communication.logged",
          category: "communication",
          personId: input.personId,
          summary: `${CONTACT_LABEL[input.channel] ?? "Message"} to ${displayName(person)} — ${COMMUNICATION_STATUS_LABELS[
            input.status
          ].toLowerCase()}.`,
        }),
      ]),
      [],
      [LOGGED_NOTICE[input.status] ?? `${COMMUNICATION_STATUS_LABELS[input.status]}.`],
    ),
  );
}

export function communicationsForPerson(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): CommunicationLogEntry[] {
  return snapshot.communications
    .filter((entry) => entry.personId === personId)
    .sort((left, right) => (left.at < right.at ? 1 : -1));
}

/**
 * One honest line about the log: drafts are counted apart from messages, and
 * "emailed" means only email the church itself sent — a mailto hand-over is
 * the person's own app, like WhatsApp.
 */
export function summariseHistory(entries: readonly CommunicationLogEntry[]): string {
  const drafts = entries.filter((entry) => entry.status === "drafted").length;
  const messages = entries.length - drafts;
  const emailed = entries.filter((entry) => entry.channel === "email" && !entry.simulated).length;
  const parts = [
    `${messages} ${messages === 1 ? "message" : "messages"} so far`,
    ...(emailed ? [`${emailed} of them emailed by the church`] : []),
  ];
  const draftNote = drafts ? ` Plus ${drafts} saved ${drafts === 1 ? "draft" : "drafts"}.` : "";
  return `${parts.join(", ")}.${draftNote}`;
}

