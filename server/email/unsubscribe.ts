import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "@/lib/result";
import { setContactPreferences } from "@/services/visitors/pipeline";
import { runSystemCommand } from "@/server/church/commands";
import type { Database } from "@/server/db/client";
import { emailSuppression } from "@/server/db/schema";

/**
 * The unsubscribe link carried by every send.
 *
 * Opt-in consent is how a person ends up receiving anything; this is the
 * matching way out, and mail providers increasingly require it (as the
 * `List-Unsubscribe` header) before they will treat bulk mail as legitimate.
 *
 * The link names a church and a person, and those ids are not secret: they
 * appear in URLs inside the application. So the link is signed. Without the
 * signature, anybody who could guess an id could opt somebody else out and
 * cancel their follow-up — a quiet, hard-to-notice way to cut a person off.
 */

export const UNSUBSCRIBE_PATH = "/unsubscribe";

export interface UnsubscribeTarget {
  churchId: string;
  personId: string;
}

export function signUnsubscribe(secret: string, target: UnsubscribeTarget): string {
  // Domain-separated and length-safe: an id containing a separator cannot
  // make two different targets sign the same.
  return createHmac("sha256", secret)
    .update(JSON.stringify(["gatherflow-unsubscribe-v1", target.churchId, target.personId]))
    .digest("base64url")
    .slice(0, 32);
}

export function unsubscribeUrl(
  appUrl: string,
  secret: string,
  target: UnsubscribeTarget,
): string {
  const base = appUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    church: target.churchId,
    person: target.personId,
    token: signUnsubscribe(secret, target),
  });
  return `${base}${UNSUBSCRIBE_PATH}?${params.toString()}`;
}

/** Reads and verifies the three parameters. Anything short of a match is refused. */
export function verifyUnsubscribe(
  secret: string,
  params: URLSearchParams,
): Result<UnsubscribeTarget> {
  const churchId = params.get("church") ?? "";
  const personId = params.get("person") ?? "";
  const token = params.get("token") ?? "";

  if (!churchId || !personId || !token) {
    return err("That unsubscribe link is incomplete.", "invalid_link");
  }

  const expected = Buffer.from(signUnsubscribe(secret, { churchId, personId }));
  const provided = Buffer.from(token);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return err("That unsubscribe link is not valid.", "invalid_link");
  }

  return ok({ churchId, personId });
}

export interface UnsubscribeOutcome {
  /** False when the person was already opted out; nothing changed. */
  changed: boolean;
}

/**
 * Applies an unsubscribe.
 *
 * Two writes. The person is opted out through the same command the interface
 * uses, which cancels their open follow-up work; and their address goes on the
 * church's suppression list, which is what stops the next send. The
 * suppression is written even if the opt-out commit loses a concurrency race,
 * so the person is protected first and the command can be retried.
 */
export async function applyUnsubscribe(
  db: Database,
  target: UnsubscribeTarget,
): Promise<Result<UnsubscribeOutcome>> {
  let email: string | undefined;

  const outcome = await runSystemCommand(db, target.churchId, (snapshot, ctx) => {
    const person = snapshot.people.find((entry) => entry.id === target.personId);
    // Deleted since the email went out: there is nobody left to opt out, and
    // a mail client retrying a one-click unsubscribe should hear "done".
    if (!person) return ok({ snapshot, events: [], notices: [] });
    email = person.email;
    if (person.contact.optedOut) return ok({ snapshot, events: [], notices: [] });
    return setContactPreferences(
      snapshot,
      {
        personId: target.personId,
        optedOut: true,
        optOutReason: "They unsubscribed using the link in an email.",
      },
      ctx,
    );
  });

  if (email) {
    await db
      .insert(emailSuppression)
      .values({
        churchId: target.churchId,
        email: email.trim().toLowerCase(),
        reason: "unsubscribed",
        detail: "unsubscribe link",
      })
      .onConflictDoNothing();
  }

  if (!outcome.ok) return outcome;
  return ok({ changed: outcome.value.notices.length > 0 });
}
