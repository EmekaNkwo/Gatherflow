import { toIsoDate } from "@/lib/dates";
import { getDatabase } from "@/server/db/client";
import { bearerMatches } from "@/server/http/bearer";
import { respondErr, respondOk } from "@/server/http/respond";
import { readPushConfig } from "@/server/push/config";
import { sendDailyReminders } from "@/server/push/reminders";
import { createWebPushSender } from "@/server/push/web-push-sender";

/**
 * Sends the daily reminders to every browser that asked for them.
 *
 * The first call of a (UTC) day is when that day's reminders go out, so
 * schedule it for the morning. Calling again is safe: each browser is sent
 * at most one reminder per day, so later calls only retry anything that
 * failed earlier. Same bearer secret as the outbox drain.
 */
export async function POST(request: Request): Promise<Response> {
  return run(request);
}

/** Vercel's cron calls with GET; same handler. */
export async function GET(request: Request): Promise<Response> {
  return run(request);
}

async function run(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected || !bearerMatches(request, expected)) return new Response("Not found", { status: 404 });

  const config = readPushConfig();
  if (!config.ok) return respondErr(config.error, config.code);

  const report = await sendDailyReminders(getDatabase(), {
    today: toIsoDate(new Date()),
    send: createWebPushSender(config.value),
  });
  return respondOk(report);
}
