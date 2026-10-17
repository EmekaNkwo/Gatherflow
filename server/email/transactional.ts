import { randomUUID } from "node:crypto";
import { err, ok, type Result } from "@/lib/result";
import { createMailjetClient, readMailjetConfig } from "./mailjet";
import { toHtml } from "./send-command";

/**
 * Mail the application sends on its own behalf: a password reset, an
 * invitation. Not pastoral mail, so it goes straight to the provider rather
 * than through the outbox — there is no person record to attach it to, no
 * consent to check, and the person is waiting for it.
 *
 * Gated on credentials only, not on `EMAIL_SENDING_ENABLED`: that gate is
 * about writing to the congregation, and a reset link to somebody who just
 * asked for one is not that. Without credentials the caller gets a refusal
 * it can show, rather than a silent nothing.
 */
export interface SystemEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendSystemEmail(email: SystemEmail): Promise<Result<void>> {
  const config = readMailjetConfig();
  if (!config.ok) {
    return err(
      "This deployment cannot send email yet, so the message could not be sent. Ask your administrator.",
      config.code,
    );
  }

  const client = createMailjetClient(config.value);
  const sent = await client.send({
    to: email.to,
    subject: email.subject,
    textPart: email.text,
    htmlPart: toHtml(email.text),
    customId: `system:${randomUUID()}`,
  });
  if (!sent.ok) {
    console.error(
      JSON.stringify({ at: new Date().toISOString(), event: "email.system.failed", error: sent.error }),
    );
    return err("The message could not be sent right now. Try again in a few minutes.", "transport");
  }
  return ok(undefined);
}
