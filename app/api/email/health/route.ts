import { getDatabase } from "@/server/db/client";
import { emailHealth } from "@/server/email/health";
import { emailAvailability } from "@/server/email/mailjet";
import { respondOk } from "@/server/http/respond";
import { bearerMatches } from "@/server/http/bearer";

/**
 * The email pipeline's vital signs, for a monitor to poll.
 *
 * Same bearer as the cron, because the same operator holds both. Returns 503
 * when something needs a human — a backlog nobody is draining, or rows that
 * have given up — so an uptime checker can alert on the status code alone
 * without parsing the body.
 */
const BACKLOG_SECONDS = 15 * 60;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  // Unset means the endpoint does not exist, as far as a caller can tell.
  if (!expected) return new Response("Not found", { status: 404 });

  if (!bearerMatches(request, expected)) return new Response("Not found", { status: 404 });

  const health = await emailHealth(getDatabase());
  const availability = emailAvailability();

  const problems: string[] = [];
  if ((health.outbox.oldestPendingSeconds ?? 0) > BACKLOG_SECONDS) {
    problems.push("The oldest queued message has waited more than 15 minutes; is the cron running?");
  }
  if (health.outbox.failed > 0) {
    problems.push(`${health.outbox.failed} message(s) have failed and will not be retried.`);
  }
  if (health.webhookFailures > 0) {
    problems.push(`${health.webhookFailures} webhook deliveries could not be processed.`);
  }

  return respondOk(
    { ok: problems.length === 0, problems, availability, ...health },
    problems.length === 0 ? 200 : 503,
  );
}
