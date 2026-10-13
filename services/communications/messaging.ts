import { err, ok, type Result } from "@/lib/result";
import { displayName, normalisePhone } from "@/lib/strings";
import type { ContactMethod, PersonId, TaskId, TemplateId } from "@/types/common";
import type { CommunicationLogEntry, CommunicationStatus } from "@/types/communication";
import { COMMUNICATION_STATUS_LABELS } from "@/types/communication";
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
  /** A user-initiated link, where the channel supports one. */
  externalLink?: string;
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
  const recentContactCount = snapshot.communications.filter(
    (entry) => entry.personId === person.id && entry.at >= monthAgo,
  ).length;

  const limit = person.contact.maxContactAttempts ?? snapshot.settings.engagement.maxContactAttempts;

  return ok({
    personId: person.id,
    templateId: template.id,
    channel,
    body: rendered.text,
    missing: rendered.missing,
    externalLink: buildExternalLink(channel, person.phone, person.email, rendered.text),
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
 */
export function buildExternalLink(
  channel: ContactMethod,
  phone: string | undefined,
  email: string | undefined,
  body: string,
): string | undefined {
  const digits = normalisePhone(phone);
  const encoded = encodeURIComponent(body);

  switch (channel) {
    case "whatsapp":
      return digits ? `https://wa.me/${digits}?text=${encoded}` : undefined;
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

/**
 * Records what actually happened to a message. There is no "delivered"
 * status: the application cannot verify delivery, so it never claims it.
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
          summary: `Simulated ${input.channel} message to ${displayName(person)} — ${COMMUNICATION_STATUS_LABELS[
            input.status
          ].toLowerCase()}.`,
        }),
      ]),
      [],
      [`${COMMUNICATION_STATUS_LABELS[input.status]} recorded (simulated).`],
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
