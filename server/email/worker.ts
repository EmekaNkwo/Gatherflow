import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { communications, messageOutbox } from "@/server/db/schema";
import type { CommunicationLogEntry } from "@/types/communication";
import type { MailjetClient } from "./mailjet";
import {
  claimDueRows,
  markAttemptFailed,
  markSent,
  releaseStaleClaims,
  suppressedAddresses,
} from "./outbox";
import { unsubscribeUrl } from "./unsubscribe";

/**
 * Draining the outbox.
 *
 * Deliberately a plain function rather than a long-lived loop, so it can be
 * driven by a cron request, a queue worker or a test with no change. Each row
 * is claimed, attempted and resolved independently: one bad address cannot
 * hold up the rest of the queue.
 */

export interface DrainOptions {
  db: Database;
  mailjet: MailjetClient;
  appUrl: string;
  /** Signs the unsubscribe link in every message. */
  unsubscribeSecret: string;
  /** How many rows to attempt in this pass. */
  limit?: number;
  workerId: string;
  /** Limits the pass to one church. Omit to drain every church. */
  churchId?: string;
  /** Claims older than this are assumed to belong to a dead worker. */
  staleClaimMinutes?: number;
  /** While a pilot is running, only these addresses may be written to. */
  allowlist?: readonly string[];
}

export interface DrainReport {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  /** Rows refused at send time: suppressed since queueing, or outside the pilot. */
  refused: number;
  releasedStale: number;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_STALE_MINUTES = 10;

export async function drainOutbox(options: DrainOptions): Promise<DrainReport> {
  const limit = options.limit ?? DEFAULT_LIMIT;

  // A worker that died mid-attempt leaves rows marked `sending` forever.
  // Reclaiming them first is the only thing that makes the queue self-healing.
  const releasedStale = await releaseStaleClaims(options.db, {
    staleAfterMinutes: options.staleClaimMinutes ?? DEFAULT_STALE_MINUTES,
    churchId: options.churchId,
  });

  const rows = await claimDueRows(options.db, {
    limit,
    workerId: options.workerId,
    churchId: options.churchId,
  });

  const report: DrainReport = {
    claimed: rows.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    refused: 0,
    releasedStale,
  };

  // Queue time is not send time. A person can unsubscribe, bounce or complain
  // in the minutes between, and the allowlist can be tightened; the row was
  // right when it was written and is checked again now that it matters.
  const refusals = await refusedAtSendTime(options, rows);

  for (const row of rows) {
    const refusal = refusals.get(row.id);
    if (refusal) {
      await markAttemptFailed(options.db, row, { error: refusal, retryable: false });
      await setCommunicationStatus(options.db, row.communicationId, "blocked");
      report.refused += 1;
      continue;
    }

    const outcome = await options.mailjet.send({
      to: row.toEmail,
      subject: row.subject,
      htmlPart: row.htmlPart,
      textPart: row.textPart,
      customId: row.customId,
      unsubscribeUrl: unsubscribeUrl(options.appUrl, options.unsubscribeSecret, {
        churchId: row.churchId,
        personId: row.personId,
      }),
    });

    if (outcome.ok) {
      await markSent(options.db, row.id, outcome.value);
      // "sent" means the provider accepted it from us — not that anybody
      // received it. `delivered` is only written when Mailjet reports that the
      // receiving server accepted the message.
      await setCommunicationStatus(options.db, row.communicationId, "sent");
      report.sent += 1;
      continue;
    }

    const status = await markAttemptFailed(options.db, row, {
      error: outcome.error,
      retryable: outcome.code === "retry",
    });

    if (status === "failed") {
      await setCommunicationStatus(options.db, row.communicationId, "failed");
      report.failed += 1;
    } else {
      report.retrying += 1;
    }
  }

  logDrain(options.workerId, report);
  return report;
}

async function refusedAtSendTime(
  options: DrainOptions,
  rows: Array<typeof messageOutbox.$inferSelect>,
): Promise<Map<string, string>> {
  const refused = new Map<string, string>();
  if (rows.length === 0) return refused;

  const byChurch = new Map<string, typeof rows>();
  for (const row of rows) {
    byChurch.set(row.churchId, [...(byChurch.get(row.churchId) ?? []), row]);
  }

  for (const [churchId, churchRows] of byChurch) {
    const suppressed = await suppressedAddresses(
      options.db,
      churchId,
      churchRows.map((row) => row.toEmail),
    );
    for (const row of churchRows) {
      if (suppressed.has(row.toEmail)) {
        refused.set(row.id, "Refused at send time: the address was suppressed after this message was queued.");
      }
    }
  }

  if (options.allowlist && options.allowlist.length > 0) {
    const allowed = new Set(options.allowlist.map((entry) => entry.trim().toLowerCase()));
    for (const row of rows) {
      if (!allowed.has(row.toEmail)) {
        refused.set(row.id, "Refused at send time: the address is not on the pilot allowlist.");
      }
    }
  }

  return refused;
}

/**
 * One line per pass, as JSON, so a log search can graph the queue without
 * parsing prose. Silent when nothing happened: an idle cron should not fill
 * the log.
 */
function logDrain(workerId: string, report: DrainReport): void {
  if (report.claimed === 0 && report.releasedStale === 0) return;
  console.info(
    JSON.stringify({ at: new Date().toISOString(), event: "email.drain", workerId, ...report }),
  );
}

/**
 * How far along a message is. A status can only move forward: the worker's
 * "sent" must not overwrite a "delivered" the webhook got in first, and a
 * late "delivered" must not erase a "bounced". Terminal outcomes share a rank
 * so none of them replaces another.
 */
const STATUS_RANK: Record<CommunicationLogEntry["status"], number> = {
  drafted: 0,
  copied: 0,
  opened_external: 0,
  sent_external: 0,
  queued: 0,
  sent: 1,
  delivered: 2,
  bounced: 3,
  blocked: 3,
  spam: 3,
  unsubscribed: 3,
  failed: 3,
};

/**
 * Moves a communication record to a new status, forward only.
 *
 * The record lives in a `jsonb` column, so the status is written in both
 * places: the promoted column the queue reads, and the document the
 * application reads. Doing it in one statement keeps them from disagreeing.
 * Returns false when the record is already further along and nothing changed.
 */
export async function setCommunicationStatus(
  db: Database,
  communicationId: string,
  status: CommunicationLogEntry["status"],
): Promise<boolean> {
  const [existing] = await db
    .select({ status: communications.status, data: communications.data })
    .from(communications)
    .where(eq(communications.id, communicationId));

  if (!existing) return false;

  const current = existing.status as CommunicationLogEntry["status"];
  if (STATUS_RANK[current] >= STATUS_RANK[status] && current !== status) return false;
  if (current === status) return true;

  await db
    .update(communications)
    .set({ status, data: { ...existing.data, status } })
    .where(eq(communications.id, communicationId));
  return true;
}

/** Rows that will never be attempted again, for an operator to look at. */
export async function failedRows(
  db: Database,
  churchId: string,
): Promise<Array<typeof messageOutbox.$inferSelect>> {
  return db
    .select()
    .from(messageOutbox)
    .where(eq(messageOutbox.churchId, churchId))
    .then((rows) => rows.filter((row) => row.status === "failed"));
}
