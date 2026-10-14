import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ok, type Result } from "@/lib/result";
import type { EmailCommunicationStatus } from "@/types/communication";
import type { Database } from "@/server/db/client";
import { emailSuppression, messageOutbox, webhookEvents } from "@/server/db/schema";
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
  /** Present on bounce: a hard bounce will not succeed on a later attempt. */
  hard_bounce?: boolean;
  error?: string;
  error_related_to?: string;
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

/** Events that mean: do not write to this address for this church again. */
const SUPPRESSING_EVENTS = new Set(["bounce", "blocked", "spam", "unsub"]);

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
  /** People to opt out, for the caller to action through a domain command. */
  optOut: Array<{ churchId: string; personId: string; reason: string }>;
}

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
    const inserted = await db
      .insert(webhookEvents)
      .values({ id: key, provider: "mailjet", event: name ?? "unknown", outboxId: row.id })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });

    if (inserted.length === 0) {
      outcome.duplicates += 1;
      continue;
    }

    const now = new Date();
    await setCommunicationStatus(db, row.communicationId, status);
    await db
      .update(messageOutbox)
      .set({ status: status === "delivered" ? "sent" : "failed", updatedAt: now })
      .where(eq(messageOutbox.id, row.id));

    if (name && SUPPRESSING_EVENTS.has(name)) {
      await db
        .insert(emailSuppression)
        .values({
          churchId: row.churchId,
          email: row.toEmail,
          reason: status,
          detail: event.error ?? event.comment ?? null,
          eventAt: now,
        })
        .onConflictDoNothing();

      outcome.optOut.push({
        churchId: row.churchId,
        personId: row.personId,
        reason: suppressionReason(name, event),
      });
    }

    outcome.applied += 1;
  }

  return ok(outcome);
}

function suppressionReason(name: string, event: MailjetEvent): string {
  switch (name) {
    case "unsub":
      return "They unsubscribed from the church's emails.";
    case "spam":
      return "They reported the church's email as spam.";
    case "blocked":
      return "Their mail server blocked the message.";
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
