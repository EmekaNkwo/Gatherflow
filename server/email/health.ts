import { and, count, desc, eq, lt, max, min, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { emailSuppression, messageOutbox, webhookInbox } from "@/server/db/schema";

/**
 * What an operator needs to know about the email pipeline, as numbers.
 *
 * Everything here is a query, nothing is a counter kept in memory: a second
 * instance, a restart or a crashed worker cannot make the figures lie. The
 * two that matter most are `oldestPendingSeconds` (a growing value means the
 * cron has stopped) and `failed` (rows nobody will retry).
 */
export interface OutboxHealth {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  /** How long the oldest *due* row has waited unclaimed, or null when none. */
  oldestPendingSeconds: number | null;
  /** Rows due now that have not been claimed: a backlog, if the cron is late. */
  overdue: number;
}

export interface EmailHealth {
  outbox: OutboxHealth;
  /** When the provider last called the webhook, or null if never. */
  lastWebhookAt: string | null;
  /** Webhook deliveries in the last day that could not be processed. */
  webhookFailures: number;
  suppressedAddresses: number;
  checkedAt: string;
}

export async function emailHealth(db: Database, churchId?: string): Promise<EmailHealth> {
  const church = churchId ? eq(messageOutbox.churchId, churchId) : undefined;

  const byStatus = await db
    .select({ status: messageOutbox.status, total: count() })
    .from(messageOutbox)
    .where(church)
    .groupBy(messageOutbox.status);

  const tally = (status: string) =>
    byStatus.find((row) => row.status === status)?.total ?? 0;

  // Only rows that are *due* count as a backlog: a row waiting out its
  // backoff is behaving, not stuck.
  const [pendingAge] = await db
    .select({
      oldest: min(messageOutbox.nextAttemptAt),
      overdue: count(),
    })
    .from(messageOutbox)
    .where(
      and(
        eq(messageOutbox.status, "pending"),
        sql`${messageOutbox.nextAttemptAt} <= now()`,
        church,
      ),
    );

  const [webhook] = await db
    .select({ last: max(webhookInbox.receivedAt) })
    .from(webhookInbox);

  // Recent only: a transient failure a month ago is not a reason to page
  // somebody today, and the provider has long since retried it.
  const [failures] = await db
    .select({ total: count() })
    .from(webhookInbox)
    .where(
      and(
        sql`${webhookInbox.error} is not null`,
        sql`${webhookInbox.receivedAt} >= now() - interval '24 hours'`,
      ),
    );

  const [suppressed] = await db
    .select({ total: count() })
    .from(emailSuppression)
    .where(churchId ? eq(emailSuppression.churchId, churchId) : undefined);

  const now = Date.now();
  return {
    outbox: {
      pending: tally("pending"),
      sending: tally("sending"),
      sent: tally("sent"),
      failed: tally("failed"),
      oldestPendingSeconds: pendingAge?.oldest
        ? Math.max(0, Math.round((now - new Date(pendingAge.oldest).getTime()) / 1000))
        : null,
      overdue: pendingAge?.overdue ?? 0,
    },
    lastWebhookAt: webhook?.last ? new Date(webhook.last).toISOString() : null,
    webhookFailures: failures?.total ?? 0,
    suppressedAddresses: suppressed?.total ?? 0,
    checkedAt: new Date(now).toISOString(),
  };
}

/** A failed send, as the interface shows it. Never the message body. */
export interface FailedSend {
  outboxId: string;
  communicationId: string;
  personId: string;
  toEmail: string;
  subject: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export async function recentFailures(
  db: Database,
  churchId: string,
  limit = 20,
): Promise<FailedSend[]> {
  const rows = await db
    .select({
      outboxId: messageOutbox.id,
      communicationId: messageOutbox.communicationId,
      personId: messageOutbox.personId,
      toEmail: messageOutbox.toEmail,
      subject: messageOutbox.subject,
      attempts: messageOutbox.attempts,
      lastError: messageOutbox.lastError,
      updatedAt: messageOutbox.updatedAt,
    })
    .from(messageOutbox)
    .where(and(eq(messageOutbox.churchId, churchId), eq(messageOutbox.status, "failed")))
    .orderBy(desc(messageOutbox.updatedAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() }));
}

/** Webhook deliveries older than this are pruned; the applied events table keeps idempotency. */
export async function pruneWebhookInbox(db: Database, olderThanDays = 30): Promise<number> {
  const removed = await db
    .delete(webhookInbox)
    .where(lt(webhookInbox.receivedAt, sql`now() - make_interval(days => ${olderThanDays})`))
    .returning({ id: webhookInbox.id });
  return removed.length;
}
