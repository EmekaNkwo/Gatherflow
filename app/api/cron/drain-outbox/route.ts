import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { createMailjetClient, readMailjetConfig } from "@/server/email/mailjet";
import { pruneWebhookInbox } from "@/server/email/health";
import { drainOutbox } from "@/server/email/worker";
import { bearerMatches } from "@/server/http/bearer";
import { pruneBudgets } from "@/server/http/rate-limit";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Drains the email outbox.
 *
 * Driven from outside — a platform cron, or any scheduler — rather than a
 * long-lived process, so it works the same on a serverless host as on a box.
 * Each pass claims a bounded number of rows, so a backlog is worked through
 * over several passes instead of one request trying to send everything.
 *
 * Deliberately *not* gated on `EMAIL_SENDING_ENABLED`: the gate decides
 * whether the interface may queue; anything already queued was queued
 * legitimately and should go.
 */
export async function POST(request: Request): Promise<Response> {
  return drain(request);
}

/** Vercel's cron and most uptime schedulers call with GET; same handler. */
export async function GET(request: Request): Promise<Response> {
  return drain(request);
}

async function drain(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  // Unset means the endpoint does not exist, as far as a caller can tell.
  if (!expected) return new Response("Not found", { status: 404 });

  if (!bearerMatches(request, expected)) {
    return new Response("Not found", { status: 404 });
  }

  // Request budgets are only needed while their window is open. Pruned
  // before the email check, so a deployment without email still tidies them.
  const prunedBudgets = await pruneBudgets(getDatabase());

  const config = readMailjetConfig();
  if (!config.ok) return respondErr(config.error, config.code);

  const report = await drainOutbox({
    db: getDatabase(),
    mailjet: createMailjetClient(config.value),
    appUrl: config.value.appUrl,
    unsubscribeSecret: config.value.unsubscribeSecret,
    allowlist: config.value.pilotAllowlist,
    // Identifies which pass claimed a row, so a stuck row can be traced.
    // Random rather than the pid: serverless instances share pids.
    workerId: `cron-${randomUUID().slice(0, 8)}`,
  });

  // Housekeeping rides on the same schedule: the raw webhook deliveries are
  // an audit trail, not a permanent record, and are dropped after a month.
  const prunedInbox = await pruneWebhookInbox(getDatabase());

  return respondOk({ ...report, prunedInbox, prunedBudgets });
}
