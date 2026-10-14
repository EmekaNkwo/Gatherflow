import { timingSafeEqual, createHash } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { createMailjetClient, readMailjetConfig } from "@/server/email/mailjet";
import { drainOutbox } from "@/server/email/worker";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Drains the email outbox.
 *
 * Driven from outside — a platform cron, or any scheduler — rather than a
 * long-lived process, so it works the same on a serverless host as on a box.
 * Each pass claims a bounded number of rows, so a backlog is worked through
 * over several passes instead of one request trying to send everything.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return respondErr("CRON_SECRET is not configured.", "not_configured");
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!matches(provided, expected)) {
    return new Response("Not found", { status: 404 });
  }

  const config = readMailjetConfig();
  if (!config.ok) return respondErr(config.error, config.code);

  const report = await drainOutbox({
    db: getDatabase(),
    mailjet: createMailjetClient(config.value),
    appUrl: config.value.appUrl,
    // Identifies which pass claimed a row, so a stuck row can be traced.
    workerId: `cron-${process.pid}`,
  });

  return respondOk(report);
}

function matches(provided: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
