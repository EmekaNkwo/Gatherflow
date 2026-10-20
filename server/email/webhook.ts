import { timingSafeEqual } from "node:crypto";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ok, type Result } from "@/lib/result";
import type { EmailCommunicationStatus } from "@/types/communication";
import type { Database } from "@/server/db/client";
import {
  emailSuppression,
  messageOutbox,
  webhookEvents,
  webhookInbox,
} from "@/server/db/schema";
import { parseCustomId } from "./outbox";
import { setCommunicationStatus } from "./worker";

/**
 * Mailjet webhook handling.
 *
 * Mailjet does **not** sign its webhooks. Its own guidance is a secret HTTPS
 * URL plus basic auth, which means the endpoint cannot prove a request came
 * from Mailjet and must be built on that assumption:
 *
 * 1. A shared secret in the path, compared in constant time.
 * 2. Nothing in the payload is trusted for anything but *identifying* a row.
 *    The status written is derived from the event name, and only applied to a
 *    row this church already created — an unknown id changes nothing.
 * 3. Events are idempotent. Mailjet retries, so an event is keyed by its own
 *    contents and a repeat is a no-op rather than a second opt-out.
 *
 * What a captured-and-replayed event can therefore achieve is nothing it did
 * not already achieve the first time.
 *
 * Field names below follow Mailjet's event reference
 * (dev.mailjet.com/docs/email-api/webhooks/event-types): every event carries
 * `event`, `time`, `MessageID`, `Message_GUID`, `email`, `CustomID` and
 * `Payload`; `bounce` adds `hard_bounce`, `blocked`, `error_related_to`,
 * `error` and `comment`; `blocked` adds `error_related_to` and `error`;
 * `spam` adds `source`; `unsub` adds `mj_list_id`. With "group events" on,
 * the body is a JSON array of these.
 */

/** Mailjet's event names. There is no `delivered`; `sent` is its equivalent. */
export type MailjetEventName =
  | "sent"
  | "open"
  | "click"
  | "bounce"
  | "blocked"
  | "spam"
  | "unsub";

export interface MailjetEvent {
  event?: string;
  time?: number;
  MessageID?: number | string;
  Message_GUID?: string;
  email?: string;
  CustomID?: string;
  /** Bounce only: true when the error was permanent (the address is dead). */
  hard_bounce?: boolean;
  /** Bounce only: true when this bounce led Mailjet to block the recipient. */
  blocked?: boolean;
  error_related_to?: string;
  error?: string;
  comment?: string;
}

/**
 * How an event changes a communication record.
 *
 * `open` and `click` are deliberately absent. They would require tracking
 * whether somebody read a pastoral message, which is more than a church needs
 * to know and more than this application should store.
 */
const STATUS_FOR_EVENT: Partial<Record<string, EmailCommunicationStatus>> = {
  sent: "delivered",
  bounce: "bounced",
  blocked: "blocked",
  spam: "spam",
  unsub: "unsubscribed",
};

/**
 * Whether an event means: do not write to this address for this church again.
 *
 * Not every failure is the recipient's. Mailjet's own guidance is to check
 * `hard_bounce` and `error` before changing a contact's status, because:
 *
 * - A *soft* bounce (full mailbox, greylisting, a server that was down) says
 *   nothing about whether the address exists. Suppressing it would cut a
 *   person off for their provider's bad afternoon.
 * - A `blocked` event with `error_related_to` of `content`, `spam`, `policy`
 *   or `system` is about *our* message or Mailjet's infrastructure, not about
 *   the recipient. `duplicate in campaign` is Mailjet deduplicating a send.
 *   None of those is a reason to never write to the person again.
 *
 * What does end the relationship: a hard bounce; a block Mailjet applied to
 * protect the sender (`preblocked`) or because the recipient is dead,
 * blacklisted or a known spam reporter; a spam complaint; an unsubscribe.
 */
export function shouldSuppress(event: MailjetEvent): boolean {
  switch (event.event) {
    case "spam":
    case "unsub":
      return true;
    case "bounce":
      return event.hard_bounce === true || event.blocked === true;
    case "blocked":
      return isRecipientProblem(event);
    default:
      return false;
  }
}

const RECIPIENT_RELATED = new Set(["recipient", "domain", "mailjet"]);
const RECIPIENT_ERRORS = new Set([
  "preblocked",
  "user unknown",
  "mailbox inactive",
  "blacklisted",
  "spam reporter",
  "invalid domain",
  "typofix",
  "no mail host",
]);

function isRecipientProblem(event: MailjetEvent): boolean {
  const error = (event.error ?? "").trim().toLowerCase();
  if (RECIPIENT_ERRORS.has(error)) return true;
  // Transient: the address may well be fine next time.
  if (["greylisted", "quota exceeded", "duplicate in campaign"].includes(error)) return false;
  const relatedTo = (event.error_related_to ?? "").trim().toLowerCase();
  return RECIPIENT_RELATED.has(relatedTo) && error !== "";
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Compare hashes so differing lengths do not leak through the length check.
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

/**
 * A stable identity for an event, so a retry is recognised.
 *
 * Built from the fields Mailjet itself sets, hashed, because the raw values
 * include an address and the table should not become a second copy of who was
 * emailed when.
 */
export function eventKey(event: MailjetEvent): string {
  const parts = [
    event.event ?? "",
    String(event.MessageID ?? ""),
    event.Message_GUID ?? "",
    event.CustomID ?? "",
    String(event.time ?? ""),
    event.email ?? "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 48);
}

/** Mailjet sends one event, or several grouped into an array. */
export function parseEventPayload(body: unknown): MailjetEvent[] {
  if (Array.isArray(body)) return body.filter(isEventLike);
  return isEventLike(body) ? [body] : [];
}

function isEventLike(value: unknown): value is MailjetEvent {
  return typeof value === "object" && value !== null && "event" in value;
}

export interface ApplyEventResult {
  applied: number;
  ignored: number;
  duplicates: number;
  /**
   * People to opt out, for the caller to action through a domain command.
   * `eventKey` lets the caller release the event (`releaseEvent`) if that
   * command fails, so the provider's retry applies it again.
   */
  optOut: Array<{ churchId: string; personId: string; reason: string; eventKey: string }>;
}

/**
 * What a provider event does to the outbox row. `failed` is reserved for a
 * send that never left, so the operator's list of things to retry stays
 * honest; a message the provider took and then reported on keeps its own
 * word.
 */
const OUTBOX_STATUS_FOR: Record<EmailCommunicationStatus, string> = {
  queued: "pending",
  sent: "sent",
  delivered: "sent",
  bounced: "bounced",
  blocked: "blocked",
  spam: "sent",
  unsubscribed: "sent",
  failed: "failed",
};

/**
 * Applies a batch of events.
 *
 * Returns the people who should be opted out rather than doing it here: that
 * is a domain change with its own rules — it cancels open follow-up work — and
 * belongs in a command, not in a webhook handler.
 */
export async function applyEvents(
  db: Database,
  events: readonly MailjetEvent[],
): Promise<Result<ApplyEventResult>> {
  const outcome: ApplyEventResult = {
    applied: 0,
    ignored: 0,
    duplicates: 0,
    optOut: [],
  };

  for (const event of events) {
    const name = event.event;
    const status = name ? STATUS_FOR_EVENT[name] : undefined;

    // An event we do not model (open, click, or something new) is accepted and
    // discarded: returning an error would make Mailjet retry it forever.
    if (!status) {
      outcome.ignored += 1;
      continue;
    }

    const row = await findOutboxRow(db, event);
    if (!row) {
      // Not ours, or long since deleted. Nothing to do, and nothing created:
      // a forged event cannot introduce a record.
      outcome.ignored += 1;
      continue;
    }

    const key = eventKey(event);
    const suppress = shouldSuppress(event);

    // The idempotency marker and every effect land in one transaction: a
    // crash half-way leaves no marker, so the provider's retry does the whole
    // thing rather than finding "already done" and doing nothing.
    const applied = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookEvents)
        .values({ id: key, provider: "mailjet", event: name ?? "unknown", outboxId: row.id })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (inserted.length === 0) return false;

      const now = new Date();
      const advanced = await setCommunicationStatus(
        tx as unknown as Database,
        row.communicationId,
        status,
      );
      // The outbox row follows the record: a report that could not move the
      // record forward does not move the row either.
      if (advanced) {
        await tx
          .update(messageOutbox)
          .set({ status: OUTBOX_STATUS_FOR[status], updatedAt: now })
          .where(eq(messageOutbox.id, row.id));
      }

      if (suppress) {
        await tx
          .insert(emailSuppression)
          .values({
            churchId: row.churchId,
            email: row.toEmail,
            reason: status,
            detail: event.error ?? event.comment ?? null,
            eventAt: now,
          })
          .onConflictDoNothing();
      }
      return true;
    });

    if (!applied) {
      outcome.duplicates += 1;
      continue;
    }

    if (suppress) {
      outcome.optOut.push({
        churchId: row.churchId,
        personId: row.personId,
        reason: suppressionReason(name ?? "", event),
        eventKey: key,
      });
    }

    outcome.applied += 1;
  }

  return ok(outcome);
}

/**
 * Forgets that an event was applied, so the provider's retry applies it
 * again. Used when the opt-out that follows an event could not be committed:
 * the suppression already holds, and the retry is what repairs the rest.
 */
export async function releaseEvent(db: Database, key: string): Promise<void> {
  await db.delete(webhookEvents).where(eq(webhookEvents.id, key));
}

function suppressionReason(name: string, event: MailjetEvent): string {
  switch (name) {
    case "unsub":
      return "They unsubscribed from the church's emails.";
    case "spam":
      return "They reported the church's email as spam.";
    case "blocked":
      return event.error === "preblocked"
        ? "Their email address has bounced before and the provider now refuses it."
        : "Their mail server blocked the message.";
    case "bounce":
      return event.hard_bounce
        ? "Their email address does not exist."
        : "Their mail server rejected the message repeatedly.";
    default:
      return "Their mail provider reported a delivery problem.";
  }
}

/**
 * Finds the row an event refers to.
 *
 * `CustomID` is the primary key for this, because we set it. The provider's
 * own identifiers are the fallback for an event that predates it or arrives
 * without it. In every case the lookup is against rows *we* created.
 */
async function findOutboxRow(
  db: Database,
  event: MailjetEvent,
): Promise<typeof messageOutbox.$inferSelect | undefined> {
  const parsed = parseCustomId(event.CustomID);
  if (parsed) {
    const [row] = await db
      .select()
      .from(messageOutbox)
      .where(
        and(
          eq(messageOutbox.id, parsed.outboxId),
          eq(messageOutbox.churchId, parsed.churchId),
        ),
      );
    if (row) return row;
  }

  if (event.Message_GUID) {
    const [row] = await db
      .select()
      .from(messageOutbox)
      .where(eq(messageOutbox.mailjetMessageUuid, event.Message_GUID));
    if (row) return row;
  }

  if (event.MessageID != null) {
    const [row] = await db
      .select()
      .from(messageOutbox)
      .where(eq(messageOutbox.mailjetMessageId, String(event.MessageID)));
    if (row) return row;
  }

  return undefined;
}

// --- Inbox persistence -----------------------------------------------------

/**
 * Records a delivery before it is processed, so that a crash half-way through
 * a batch leaves evidence rather than a gap. Returns the inbox id for the
 * outcome to be written against.
 */
export async function recordDelivery(
  db: Database,
  body: unknown,
  events: number,
): Promise<string> {
  const id = randomUUID();
  await db.insert(webhookInbox).values({
    id,
    provider: "mailjet",
    body: body === undefined ? null : (body as object),
    events,
  });
  return id;
}

export async function recordOutcome(
  db: Database,
  inboxId: string,
  outcome: { applied: number; ignored: number; duplicates: number; optedOut: number },
): Promise<void> {
  await db
    .update(webhookInbox)
    .set({ ...outcome, processedAt: sql`now()`, error: null })
    .where(eq(webhookInbox.id, inboxId));
}

export async function recordFailure(db: Database, inboxId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(webhookInbox)
    .set({ processedAt: sql`now()`, error: message.slice(0, 1000) })
    .where(eq(webhookInbox.id, inboxId));
}
