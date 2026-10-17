import { setContactPreferences } from "@/services/visitors/pipeline";
import { recordAudit, SYSTEM_USER } from "@/server/audit/audit";
import { runSystemCommand } from "@/server/church/commands";
import { getDatabase } from "@/server/db/client";
import { readMailjetConfig } from "@/server/email/mailjet";
import {
  applyEvents,
  constantTimeEquals,
  parseEventPayload,
  recordDelivery,
  recordFailure,
  recordOutcome,
  releaseEvent,
} from "@/server/email/webhook";
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
 * discarded would never stop. The one exception is a processing failure,
 * which returns 500 *after* the delivery has been written to the inbox — so
 * Mailjet retries, the applied-events table makes the retry safe, and the
 * failed delivery is kept for an operator to look at either way.
 */
const MAX_BODY_BYTES = 1_000_000;

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

  // Mailjet's grouped deliveries are small; a megabyte is not one of them.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return respondErr("That webhook body is too large.", "invalid_input");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respondErr("That webhook body was not valid JSON.", "invalid_input");
  }

  const db = getDatabase();
  const events = parseEventPayload(body);
  const inboxId = await recordDelivery(db, body, events.length);

  if (events.length === 0) {
    // Well-formed but uninteresting. 200, so it is not sent again.
    const empty = { applied: 0, ignored: 0, duplicates: 0, optedOut: 0 };
    await recordOutcome(db, inboxId, empty);
    return respondOk(empty);
  }

  try {
    const applied = await applyEvents(db, events);
    if (!applied.ok) {
      await recordFailure(db, inboxId, applied.error);
      return respondErr(applied.error, applied.code);
    }

    // Opting somebody out is a domain change with its own consequences — it
    // cancels their open follow-up work — so it goes through the same command
    // the interface uses, not a direct write.
    let optedOut = 0;
    const failedOptOuts: string[] = [];
    for (const target of applied.value.optOut) {
      const outcome = await runSystemCommand(db, target.churchId, (snapshot, ctx) => {
        const person = snapshot.people.find((entry) => entry.id === target.personId);
        // Already gone, or already out: nothing to do, and nothing to retry.
        if (!person || person.contact.optedOut) return { ok: true, value: { snapshot, events: [], notices: [] } };
        return setContactPreferences(
          snapshot,
          { personId: target.personId, optedOut: true, optOutReason: target.reason },
          ctx,
        );
      });
      await recordAudit(db, {
        churchId: target.churchId,
        userId: SYSTEM_USER,
        action: "email.provider_opt_out",
        targetId: target.personId,
        outcome: outcome.ok ? "ok" : "failed",
        code: outcome.ok ? null : outcome.code,
      });
      if (outcome.ok) {
        optedOut += 1;
      } else {
        // The address is already suppressed; what did not happen is the
        // opt-out and the cancelling of follow-up work. Forget the event so
        // the provider's retry runs it again.
        await releaseEvent(db, target.eventKey);
        failedOptOuts.push(outcome.error);
      }
    }

    if (failedOptOuts.length > 0) {
      await recordFailure(db, inboxId, failedOptOuts.join("; "));
      return respondErr("An opt-out could not be recorded; the event will be retried.", "storage_failed");
    }

    const summary = {
      applied: applied.value.applied,
      ignored: applied.value.ignored,
      duplicates: applied.value.duplicates,
      optedOut,
    };
    await recordOutcome(db, inboxId, summary);
    console.info(
      JSON.stringify({ at: new Date().toISOString(), event: "email.webhook", inboxId, ...summary }),
    );
    return respondOk(summary);
  } catch (error: unknown) {
    await recordFailure(db, inboxId, error);
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "email.webhook.failed",
        inboxId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return respondErr("The events could not be processed; they will be retried.", "storage_failed");
  }
}
