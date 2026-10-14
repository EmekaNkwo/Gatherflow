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
  unsubscribeUrl,
} from "./outbox";

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
  /** How many rows to attempt in this pass. */
  limit?: number;
  workerId: string;
  /** Limits the pass to one church. Omit to drain every church. */
  churchId?: string;
  /** Claims older than this are assumed to belong to a dead worker. */
  staleClaimMinutes?: number;
}

export interface DrainReport {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
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
    releasedStale,
  };

  for (const row of rows) {
    const outcome = await options.mailjet.send({
      to: row.toEmail,
      subject: row.subject,
      htmlPart: row.htmlPart,
      textPart: row.textPart,
      customId: row.customId,
      unsubscribeUrl: unsubscribeUrl(options.appUrl, row.churchId, row.personId),
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

  return report;
}

/**
 * Moves a communication record to a new status.
 *
 * The record lives in a `jsonb` column, so the status is written in both
 * places: the promoted column the queue reads, and the document the
 * application reads. Doing it in one statement keeps them from disagreeing.
 */
export async function setCommunicationStatus(
  db: Database,
  communicationId: string,
  status: CommunicationLogEntry["status"],
): Promise<void> {
  const [existing] = await db
    .select({ data: communications.data })
    .from(communications)
    .where(eq(communications.id, communicationId));

  if (!existing) return;

  await db
    .update(communications)
    .set({ status, data: { ...existing.data, status } })
    .where(eq(communications.id, communicationId));
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
