import { headers } from "next/headers";
import { z } from "zod";
import { auditResult } from "@/server/audit/audit";
import { resolveChurchSession } from "@/server/auth/session";
import { authorize } from "@/server/auth/authorize";
import { readChurch } from "@/server/church/commands";
import { parseCommandInput } from "@/server/church/input";
import { getDatabase } from "@/server/db/client";
import { recentFailures } from "@/server/email/health";
import {
  assertSendingEnabled,
  emailAvailability,
  readMailjetConfig,
} from "@/server/email/mailjet";
import { sendTemplatedEmail } from "@/server/email/send-command";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Sending an email, over HTTP.
 *
 * This is not a registry command, on purpose: the registry holds pure
 * functions over a snapshot, and a send needs the database (the suppression
 * list, the outbox row) and the provider configuration. It is the one write
 * the browser can ask for that the local mode cannot perform at all.
 *
 * Three gates, in order, before anything is queued: the session must hold
 * `communications.write`; the deployment must have sending switched on; and
 * the body must parse. The rules themselves (consent, address, suppression,
 * pilot allowlist) live in `sendTemplatedEmail`.
 */
const sendSchema = z.object({
  personId: z.string().min(1),
  templateId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  subject: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^\r\n]*$/, "a subject cannot contain line breaks")
    .optional(),
  body: z.string().max(5_000).optional(),
  serviceName: z.string().max(200).optional(),
  serviceDate: z.string().max(40).optional(),
  groupName: z.string().max(200).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const db = getDatabase();

  const session = await resolveChurchSession({ db, headers: await headers() });
  if (!session.ok) return respondErr(session.error, session.code);

  const audit = { churchId: session.value.churchId, userId: session.value.userId, actorId: session.value.teamMemberId, action: "email.send" };

  const permitted = authorize(session.value, "communications.write");
  if (!permitted.ok) {
    await auditResult(db, audit, permitted);
    return respondErr(permitted.error, permitted.code);
  }

  const config = readMailjetConfig();
  if (!config.ok) return respondErr(config.error, config.code);
  const enabled = assertSendingEnabled(config.value);
  if (!enabled.ok) {
    await auditResult(db, audit, enabled);
    return respondErr(enabled.error, enabled.code);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(sendSchema, raw);
  if (!input.ok) return respondErr(input.error, input.code);

  const outcome = await sendTemplatedEmail(db, session.value, input.value, {
    allowlist: config.value.pilotAllowlist,
  });
  await auditResult(db, { ...audit, targetId: input.value.personId }, outcome);
  if (!outcome.ok) return respondErr(outcome.error, outcome.code);

  console.info(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "email.queued",
      churchId: session.value.churchId,
      outboxId: outcome.value.outboxId,
    }),
  );

  const scoped = await readChurch({ db, session: session.value });
  return respondOk({
    snapshot: scoped.snapshot,
    notices: ["Email queued. It will be sent within a few minutes."],
    data: outcome.value,
  });
}

/**
 * The state of email for this church: whether sending is offered, and the
 * sends that will not be retried. Subjects and addresses only — never a body.
 */
export async function GET(): Promise<Response> {
  const db = getDatabase();

  const session = await resolveChurchSession({ db, headers: await headers() });
  if (!session.ok) return respondErr(session.error, session.code);

  const permitted = authorize(session.value, "communications.write");
  if (!permitted.ok) return respondErr(permitted.error, permitted.code);

  return respondOk({
    availability: emailAvailability(),
    failures: await recentFailures(db, session.value.churchId),
  });
}
