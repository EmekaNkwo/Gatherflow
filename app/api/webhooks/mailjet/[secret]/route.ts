import { setContactPreferences } from "@/services/visitors/pipeline";
import { runSystemCommand } from "@/server/church/commands";
import { getDatabase } from "@/server/db/client";
import { readMailjetConfig } from "@/server/email/mailjet";
import { applyEvents, constantTimeEquals, parseEventPayload } from "@/server/email/webhook";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Mailjet's event callback.
 *
 * The secret lives in the path because Mailjet does not sign its webhooks and
 * offers no better option. It is compared in constant time, and a mismatch
 * returns 404 rather than 401 so that probing cannot distinguish "wrong
 * secret" from "no such endpoint".
 *
 * A successful request always returns 200, even when every event was ignored:
 * a non-2xx makes Mailjet retry, and retrying an event we have deliberately
 * discarded would never stop.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  const config = readMailjetConfig();
  if (!config.ok) return respondErr(config.error, config.code);

  const { secret } = await params;
  if (!constantTimeEquals(secret, config.value.webhookSecret)) {
    return new Response("Not found", { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respondErr("That webhook body was not valid JSON.", "invalid_input");
  }

  const events = parseEventPayload(body);
  if (events.length === 0) {
    // Well-formed but uninteresting. 200, so it is not sent again.
    return respondOk({ applied: 0, ignored: 0, duplicates: 0, optedOut: 0 });
  }

  const db = getDatabase();
  const applied = await applyEvents(db, events);
  if (!applied.ok) return respondErr(applied.error, applied.code);

  // Opting somebody out is a domain change with its own consequences — it
  // cancels their open follow-up work — so it goes through the same command
  // the interface uses, not a direct write.
  let optedOut = 0;
  for (const target of applied.value.optOut) {
    const outcome = await runSystemCommand(db, target.churchId, (snapshot, ctx) =>
      setContactPreferences(
        snapshot,
        { personId: target.personId, optedOut: true, optOutReason: target.reason },
        ctx,
      ),
    );
    if (outcome.ok) optedOut += 1;
  }

  return respondOk({
    applied: applied.value.applied,
    ignored: applied.value.ignored,
    duplicates: applied.value.duplicates,
    optedOut,
  });
}
