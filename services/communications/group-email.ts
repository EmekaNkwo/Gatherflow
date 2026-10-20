import { err, ok, type Result } from "@/lib/result";
import { displayName } from "@/lib/strings";
import type { ContactMethod, PersonId, TemplateId } from "@/types/common";
import type { ManualCommunicationStatus } from "@/types/communication";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { draftMessage, logCommunication, type MessageDraft } from "./messaging";
import { renderTemplate, type RenderedTemplate } from "./template-engine";

/**
 * Emailing several people through the sender's own email app.
 *
 * Nothing here sends anything. It decides who can be written to, words the
 * message (one per person, or one for everyone), and builds the `mailto:`
 * links the person opens. What they then did is recorded only when they say
 * so (`logCommunications`).
 */

export type SkipReason = "opted_out" | "no_permission" | "no_email";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  opted_out: "asked not to be contacted",
  no_permission: "hasn't agreed to be contacted",
  no_email: "no email address",
};

export interface EmailRecipient {
  person: Person;
  email: string;
}

export interface SkippedRecipient {
  personId: PersonId;
  name: string;
  reason: SkipReason;
}

export interface SortedRecipients {
  ready: EmailRecipient[];
  skipped: SkippedRecipient[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who can be emailed, in the order chosen, and who can't with the reason.
 * Consent comes first: somebody who opted out is named as that, never as a
 * missing address. People no longer in the directory are dropped silently.
 */
export function sortRecipients(snapshot: ChurchSnapshot, personIds: readonly PersonId[]): SortedRecipients {
  const byId = new Map(snapshot.people.map((person) => [person.id, person]));
  const people = Array.from(new Set(personIds))
    .map((personId) => byId.get(personId))
    .filter((person): person is Person => Boolean(person));

  return people.reduce<SortedRecipients>(
    (sorted, person) => {
      const reason = skipReason(person);
      if (reason) {
        return { ...sorted, skipped: [...sorted.skipped, { personId: person.id, name: displayName(person), reason }] };
      }
      return { ...sorted, ready: [...sorted.ready, { person, email: person.email!.trim() }] };
    },
    { ready: [], skipped: [] },
  );
}

function skipReason(person: Person): SkipReason | null {
  if (person.contact.optedOut) return "opted_out";
  if (!person.contact.permissionGranted) return "no_permission";
  if (!person.email || !EMAIL_PATTERN.test(person.email.trim())) return "no_email";
  return null;
}

/** Placeholders that name one person, so one shared email can't fill them. */
const PERSONAL_TOKEN = /\{\{\s*(firstName|preferredName)\s*\}\}/g;

export function hasPersonalPlaceholders(body: string): boolean {
  return new RegExp(PERSONAL_TOKEN.source).test(body);
}

/** What a shared email says where a template names the person. */
export const EVERYONE = "everyone";

export interface SharedDetails {
  senderName: string;
  serviceName?: string;
  groupName?: string;
}

/**
 * One wording for a whole group. "Hello {{firstName}}" becomes "Hello
 * everyone"; the service date is filled only when every recipient shares it,
 * otherwise it stays a visible gap for the sender to replace.
 */
export function renderForEveryone(
  snapshot: ChurchSnapshot,
  body: string,
  people: readonly Person[],
  details: SharedDetails,
): RenderedTemplate {
  const dates = new Set(people.map((person) => person.visitor?.firstVisitDate));
  const sharedDate = dates.size === 1 ? [...dates][0] : undefined;

  return renderTemplate(body.replace(PERSONAL_TOKEN, EVERYONE), {
    person: { firstName: EVERYONE, lastName: "" },
    churchName: snapshot.settings.churchName,
    senderName: details.senderName,
    serviceDate: sharedDate,
    serviceName: details.serviceName ?? "our Sunday service",
    groupName: details.groupName,
  });
}

/**
 * Each person's own message, exactly as the one-person composer would write
 * it. Anyone the drafting refuses is left out; `sortRecipients` has already
 * named them.
 */
export function personalDrafts(
  snapshot: ChurchSnapshot,
  templateId: TemplateId,
  people: readonly Person[],
  ctx: CommandContext,
  groupName?: string,
): MessageDraft[] {
  return people.flatMap((person) => {
    const drafted = draftMessage(snapshot, { personId: person.id, templateId, channel: "email", groupName }, ctx);
    return drafted.ok ? [drafted.value] : [];
  });
}

export interface MailtoParts {
  to?: readonly string[];
  bcc?: readonly string[];
  subject: string;
  body: string;
}

/**
 * A `mailto:` link. Subject and body are percent-encoded; addresses keep
 * their `@` and are joined by plain commas, the form every mail app reads.
 * A blank subject is left out rather than sent empty.
 */
export function buildMailto({ to = [], bcc = [], subject, body }: MailtoParts): string {
  const query = [
    bcc.length ? `bcc=${addresses(bcc)}` : null,
    subject.trim() ? `subject=${encodeURIComponent(subject.trim())}` : null,
    body ? `body=${encodeURIComponent(body)}` : null,
  ].filter(Boolean);
  return `mailto:${addresses(to)}${query.length ? `?${query.join("&")}` : ""}`;
}

function addresses(list: readonly string[]): string {
  return list.map((address) => encodeURIComponent(address).replace(/%40/g, "@")).join(",");
}

/**
 * Some mail apps (Outlook on Windows above all) cut off a `mailto:` link
 * past roughly 2,000 characters, so a long list goes out in several emails.
 */
export const MAILTO_MAX_LENGTH = 1_900;

/**
 * Splits recipients so each email's link fits, keeping their order. `null`
 * when the message alone is too long for any link: copy it instead.
 */
export function bccBatches(
  emails: readonly string[],
  subject: string,
  body: string,
  maxLength = MAILTO_MAX_LENGTH,
): string[][] | null {
  const fits = (batch: readonly string[]) => buildMailto({ bcc: batch, subject, body }).length <= maxLength;

  const batches: string[][] = [];
  for (const email of emails) {
    const current = batches.at(-1);
    if (current && fits([...current, email])) {
      batches[batches.length - 1] = [...current, email];
    } else if (fits([email])) {
      batches.push([email]);
    } else {
      return null;
    }
  }
  return batches;
}

/** The most people one group message is recorded for in a single request. */
export const GROUP_MESSAGE_MAX_PEOPLE = 200;

export interface LogCommunicationsInput {
  channel: ContactMethod;
  status: ManualCommunicationStatus;
  templateId?: TemplateId;
  entries: readonly { personId: PersonId; body: string }[];
}

const NOT_RECORDED: Record<string, string> = {
  opted_out: "they opted out of contact",
  no_permission: "they haven't agreed to be contacted",
  not_found: "they're no longer in the directory",
};

/**
 * Records one message per person, each through the same checks as a single
 * record. Somebody who opted out between choosing and confirming is skipped
 * and named; the rest are still recorded. Refused only when nobody could be.
 */
export function logCommunications(
  snapshot: ChurchSnapshot,
  input: LogCommunicationsInput,
  ctx: CommandContext,
): Result<CommandResult> {
  let next = snapshot;
  let recorded = 0;
  const refusals: { personId: PersonId; error: string; code?: string }[] = [];

  for (const entry of input.entries) {
    const outcome = logCommunication(
      next,
      { personId: entry.personId, channel: input.channel, status: input.status, body: entry.body, templateId: input.templateId },
      ctx,
    );
    if (outcome.ok) {
      next = outcome.value.snapshot;
      recorded += 1;
    } else {
      refusals.push({ personId: entry.personId, error: outcome.error, code: outcome.code });
    }
  }

  if (!recorded) {
    const first = refusals[0];
    return err(first?.error ?? "Nothing to record.", first?.code);
  }

  const noun = input.channel === "email" ? "email" : "message";
  const skippedNotices = refusals.map((refusal) => {
    const person = snapshot.people.find((candidate) => candidate.id === refusal.personId);
    const who = person ? displayName(person) : "someone";
    return `Not recorded for ${who}: ${NOT_RECORDED[refusal.code ?? ""] ?? refusal.error}.`;
  });

  return ok(result(next, [], [`Recorded ${recorded} ${recorded === 1 ? noun : `${noun}s`}`, ...skippedNotices]));
}
