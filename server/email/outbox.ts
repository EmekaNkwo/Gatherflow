import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { createId } from "@/lib/ids";
import { displayName } from "@/lib/strings";
import { activity, patch, withActivity } from "@/services/core/snapshot";
import type { CommandContext } from "@/services/core/context";
import { result, type CommandResult } from "@/services/core/events";
import type { CommunicationLogEntry } from "@/types/communication";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { PersonId, TaskId, TemplateId } from "@/types/common";
import type { Database } from "@/server/db/client";
import { emailSuppression, messageOutbox } from "@/server/db/schema";

/**
 * Queueing an email.
 *
 * Three things have to be true before anything is queued, and all three are
 * checked here rather than at the call site so no caller can forget one:
 * the person consented, they have an address, and that address is not
 * suppressed. A suppressed address is the church's own record that this
 * mailbox bounced, complained or unsubscribed — sending again would damage the
 * domain's reputation and ignore somebody's explicit answer.
 */

export const NOT_CONFIGURED = "not_configured";
export const SUPPRESSED = "suppressed";

export interface QueueEmailInput {
  personId: PersonId;
  subject: string;
  htmlPart: string;
  textPart: string;
  templateId?: TemplateId;
  taskId?: TaskId;
}

export interface QueuedEmail {
  outboxId: string;
  communicationId: string;
  toEmail: string;
}

/**
 * The snapshot half of queueing: appends the communication record with status
 * `queued` and reports what the database half needs.
 *
 * Pure, like every other command, so the decision to send is testable without
 * a database or a provider.
 */
export function queueEmailCommand(
  snapshot: ChurchSnapshot,
  input: QueueEmailInput,
  ctx: CommandContext,
): Result<CommandResult & { queued: QueuedEmail }> {
  const person = snapshot.people.find((entry) => entry.id === input.personId);
  if (!person) return err("That person is no longer in the directory.", "not_found");

  if (person.contact.optedOut) {
    return err(
      `${displayName(person)} has opted out of contact. No message can be sent.`,
      "opted_out",
    );
  }
  if (!person.contact.permissionGranted) {
    return err(
      `${displayName(person)} has not given permission to be contacted.`,
      "no_permission",
    );
  }
  if (!person.email) {
    return err(`${displayName(person)} has no email address on record.`, "no_address");
  }

  const communicationId = ctx.id("comm");
  const entry: CommunicationLogEntry = {
    id: communicationId,
    personId: person.id,
    templateId: input.templateId,
    taskId: input.taskId,
    channel: "email",
    status: "queued",
    body: input.textPart,
    at: ctx.nowIso,
    actorId: ctx.actorId,
    // A real send. The interface badges this differently from a draft.
    simulated: false,
  };

  const next = patch(snapshot, { communications: [...snapshot.communications, entry] });

  return ok({
    ...result(
      withActivity(next, ctx, [
        activity(ctx, {
          type: "communication.logged",
          category: "communication",
          personId: person.id,
          summary: `Email queued to ${displayName(person)}.`,
        }),
      ]),
      [],
      ["Email queued."],
    ),
    queued: {
      outboxId: ctx.id("out"),
      communicationId,
      toEmail: person.email,
    },
  });
}

/**
 * Volume limits, as a brake on a bug or a misused account.
 *
 * Opt-in consent and the suppression list protect each *person*; nothing
 * above protects the *church* from a script that queues a thousand messages
 * in a loop, which would burn the provider quota and the domain's reputation
 * in one afternoon. Two limits, both read from the outbox so every instance
 * sees the same count: how many a church may queue in an hour, and how soon
 * the same person may be written to again.
 */
export const RATE_LIMITED = "rate_limited";
export const DEFAULT_HOURLY_LIMIT = 200;
export const DEFAULT_PERSON_COOLDOWN_MINUTES = 10;

export interface SendLimits {
  perChurchPerHour?: number;
  perPersonCooldownMinutes?: number;
}

export async function checkSendLimits(
  db: Database,
  churchId: string,
  personId: string,
  limits: SendLimits = {},
): Promise<Result<void>> {
  const hourly = limits.perChurchPerHour ?? DEFAULT_HOURLY_LIMIT;
  const cooldown = limits.perPersonCooldownMinutes ?? DEFAULT_PERSON_COOLDOWN_MINUTES;

  const [recent] = await db
    .select({ total: count() })
    .from(messageOutbox)
    .where(
      and(
        eq(messageOutbox.churchId, churchId),
        gte(messageOutbox.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  if ((recent?.total ?? 0) >= hourly) {
    return err(
      `This church has queued ${hourly} emails in the last hour, which is its limit. Try again later.`,
      RATE_LIMITED,
    );
  }

  const [samePerson] = await db
    .select({ total: count() })
    .from(messageOutbox)
    .where(
      and(
        eq(messageOutbox.churchId, churchId),
        eq(messageOutbox.personId, personId),
        gte(messageOutbox.createdAt, sql`now() - make_interval(mins => ${cooldown})`),
      ),
    );
  if ((samePerson?.total ?? 0) > 0) {
    return err(
      `An email to this person was queued less than ${cooldown} minutes ago. Wait before sending another.`,
      RATE_LIMITED,
    );
  }

  return ok(undefined);
}

/** Addresses this church must not write to again. */
export async function suppressedAddresses(
  db: Database,
  churchId: string,
  emails: readonly string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ email: emailSuppression.email })
    .from(emailSuppression)
    .where(
      and(
        eq(emailSuppression.churchId, churchId),
        inArray(
          emailSuppression.email,
          emails.map((value) => value.trim().toLowerCase()),
        ),
      ),
    );
  return new Set(rows.map((row) => row.email));
}

export async function isSuppressed(
  db: Database,
  churchId: string,
  email: string,
): Promise<boolean> {
  return (await suppressedAddresses(db, churchId, [email])).has(
    email.trim().toLowerCase(),
  );
}

export interface InsertOutboxRow {
  churchId: string;
  queued: QueuedEmail;
  input: QueueEmailInput;
  personId: string;
}

/**
 * Writes the queue row. Called inside the commit's transaction via `enlist`,
 * so it lands with the communication record or not at all.
 */
export async function insertOutboxRow(
  tx: Database,
  { churchId, queued, input, personId }: InsertOutboxRow,
): Promise<void> {
  await tx.insert(messageOutbox).values({
    id: queued.outboxId,
    churchId,
    communicationId: queued.communicationId,
    personId,
    toEmail: queued.toEmail.trim().toLowerCase(),
    subject: input.subject,
    htmlPart: input.htmlPart,
    textPart: input.textPart,
    // The correlation key Mailjet echoes back on every event for this message.
    customId: `${churchId}:${queued.outboxId}`,
    status: "pending",
  });
}

export function outboxCustomId(churchId: string, outboxId: string): string {
  return `${churchId}:${outboxId}`;
}

/** Reverses `outboxCustomId`, refusing anything that is not one of ours. */
export function parseCustomId(
  value: string | null | undefined,
): { churchId: string; outboxId: string } | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    churchId: value.slice(0, separator),
    outboxId: value.slice(separator + 1),
  };
}

/**
 * Rows due for a send attempt, claimed so no other worker takes them.
 *
 * Two deliberate choices here.
 *
 * The select and the claim run in one transaction: `FOR UPDATE SKIP LOCKED`
 * holds the chosen rows and steps over any another worker is already holding,
 * which is what makes a second worker useful rather than a source of duplicate
 * sends. Without the transaction the lock would be released between the two
 * statements and two workers could claim the same row.
 *
 * And every time is the *database's* time, never the caller's. `nextAttemptAt`
 * is written by the database, so comparing it against a timestamp from some
 * other machine's clock means a row can come due early or late by whatever the
 * skew happens to be — across several instances there is no single "now" to
 * agree on. One clock decides.
 */
export async function claimDueRows(
  db: Database,
  options: { limit: number; workerId: string; churchId?: string },
): Promise<Array<typeof messageOutbox.$inferSelect>> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: messageOutbox.id })
      .from(messageOutbox)
      .where(
        and(
          eq(messageOutbox.status, "pending"),
          lte(messageOutbox.nextAttemptAt, sql`now()`),
          ...(options.churchId ? [eq(messageOutbox.churchId, options.churchId)] : []),
        ),
      )
      .orderBy(messageOutbox.nextAttemptAt)
      .limit(options.limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(messageOutbox)
      .set({
        status: "sending",
        lockedAt: sql`now()`,
        lockedBy: options.workerId,
        attempts: sql`${messageOutbox.attempts} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        inArray(
          messageOutbox.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

/** Minutes to wait before attempt N+1. Doubling, so a bad patch backs off fast. */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

export { createId };
export const MAX_SEND_ATTEMPTS = 5;

/** Marks a claimed row as handed over, recording the provider's identifiers. */
export async function markSent(
  db: Database,
  outboxId: string,
  ids: { messageId: string | null; messageUuid: string | null },
): Promise<void> {
  await db
    .update(messageOutbox)
    .set({
      status: "sent",
      mailjetMessageId: ids.messageId,
      mailjetMessageUuid: ids.messageUuid,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: sql`now()`,
    })
    .where(eq(messageOutbox.id, outboxId));
}

/**
 * Records a failed attempt.
 *
 * A retryable failure goes back to `pending` with a later due time; a
 * permanent one, or one that has used up its attempts, stops being retried so
 * the failure becomes visible rather than looping silently.
 */
export async function markAttemptFailed(
  db: Database,
  row: { id: string; attempts: number },
  options: { error: string; retryable: boolean },
): Promise<"pending" | "failed"> {
  const exhausted = row.attempts >= MAX_SEND_ATTEMPTS;
  const status = options.retryable && !exhausted ? "pending" : "failed";
  const minutes = backoffMinutes(row.attempts);

  await db
    .update(messageOutbox)
    .set({
      status,
      lastError: options.error.slice(0, 1000),
      // Offset from the database's clock, for the same reason the claim reads
      // it: the next attempt is due relative to one agreed time.
      nextAttemptAt: sql`now() + make_interval(mins => ${minutes})`,
      lockedAt: null,
      lockedBy: null,
      updatedAt: sql`now()`,
    })
    .where(eq(messageOutbox.id, row.id));

  return status;
}

/** Rows stuck in `sending` because a worker died mid-attempt. */
export async function releaseStaleClaims(
  db: Database,
  options: { staleAfterMinutes: number; churchId?: string },
): Promise<number> {
  const released = await db
    .update(messageOutbox)
    .set({ status: "pending", lockedAt: null, lockedBy: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(messageOutbox.status, "sending"),
        lte(
          messageOutbox.lockedAt,
          sql`now() - make_interval(mins => ${options.staleAfterMinutes})`,
        ),
        ...(options.churchId ? [eq(messageOutbox.churchId, options.churchId)] : []),
      ),
    )
    .returning({ id: messageOutbox.id });
  return released.length;
}
