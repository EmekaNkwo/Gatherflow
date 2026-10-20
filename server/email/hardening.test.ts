// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { createDatabase, type Database } from "@/server/db/client";
import {
  churches,
  communications,
  emailSuppression,
  messageOutbox,
  webhookInbox,
} from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { emailHealth, pruneWebhookInbox, recentFailures } from "./health";
import {
  assertSendingEnabled,
  emailAvailability,
  NOT_CONFIGURED,
  NOT_ENABLED,
  readMailjetConfig,
} from "./mailjet";
import { backoffMinutes, MAX_SEND_ATTEMPTS, outboxCustomId, RATE_LIMITED } from "./outbox";
import { NOT_IN_PILOT, sendTemplatedEmail } from "./send-command";
import { SEND_CONTEXT, scriptedClient, seed, seededChurch } from "./test-fixtures";
import { applyUnsubscribe } from "./unsubscribe";
import {
  applyEvents,
  recordDelivery,
  recordFailure,
  recordOutcome,
  shouldSuppress,
} from "./webhook";
import { drainOutbox } from "./worker";

/**
 * Production hardening of the email pipeline: what happens when several
 * workers run at once, when a worker dies, when the provider keeps failing,
 * and when the provider's reports need interpreting rather than obeying.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;

let db: Database;
let counter = 0;
const created: string[] = [];

function nextChurchId(): string {
  counter += 1;
  const id = `hardening-church-${process.pid}-${counter}`;
  created.push(id);
  return id;
}

const church = () => seededChurch(db, nextChurchId());

async function queueMany(count: number) {
  const context = await church();
  const outboxIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const queued = await sendTemplatedEmail(
      db,
      context.session,
      {
        personId: context.person.id,
        templateId: context.template.id,
        subject: `Message ${index + 1}`,
        ...SEND_CONTEXT,
      },
      // These tests queue several messages to one person on purpose.
      { limits: { perPersonCooldownMinutes: 0 } },
    );
    if (!queued.ok) throw new Error(queued.error);
    outboxIds.push(queued.value.outboxId);
  }
  return { ...context, outboxIds };
}

function drain(
  churchId: string,
  client: ReturnType<typeof scriptedClient>["client"],
  extra: Partial<Parameters<typeof drainOutbox>[0]> = {},
) {
  return drainOutbox({
    db,
    mailjet: client,
    appUrl: "https://church.example.com",
    unsubscribeSecret: "unsub-secret",
    workerId: "test",
    churchId,
    ...extra,
  });
}

describe.skipIf(!CONNECTION)("email hardening", () => {
  beforeAll(() => {
    // Enough connections for the concurrent workers to hold separate
    // transactions, which is the whole point of that test.
    db = createDatabase({ connectionString: CONNECTION as string, max: 6 });
  });

  afterAll(async () => {
    for (const id of created) {
      await db.delete(churches).where(eq(churches.id, id));
    }
  });

  describe("worker concurrency", () => {
    it("lets three workers drain the same queue without sending anything twice", async () => {
      const { churchId, outboxIds } = await queueMany(6);
      const { client, calls } = scriptedClient();

      const reports = await Promise.all([
        drain(churchId, client, { workerId: "a", limit: 2 }),
        drain(churchId, client, { workerId: "b", limit: 2 }),
        drain(churchId, client, { workerId: "c", limit: 2 }),
      ]);

      const claimed = reports.reduce((sum, report) => sum + report.claimed, 0);
      const sent = reports.reduce((sum, report) => sum + report.sent, 0);
      expect(claimed).toBe(6);
      expect(sent).toBe(6);

      // Every row went exactly once: the claim is `FOR UPDATE SKIP LOCKED`
      // inside one transaction, so a row one worker holds is invisible to the
      // others rather than claimed by all three.
      const customIds = calls.map((call) => call.body.Messages[0].CustomID);
      expect(new Set(customIds).size).toBe(6);
      expect(customIds.sort()).toEqual(
        outboxIds.map((id) => outboxCustomId(churchId, id)).sort(),
      );

      const rows = await db
        .select({ status: messageOutbox.status, lockedBy: messageOutbox.lockedBy })
        .from(messageOutbox)
        .where(inArray(messageOutbox.id, outboxIds));
      expect(rows.every((row) => row.status === "sent" && row.lockedBy === null)).toBe(true);
    });

    it("drains a backlog over several bounded passes", async () => {
      const { churchId } = await queueMany(5);
      const { client } = scriptedClient();

      const first = await drain(churchId, client, { limit: 2 });
      const second = await drain(churchId, client, { limit: 2 });
      const third = await drain(churchId, client, { limit: 2 });
      const fourth = await drain(churchId, client, { limit: 2 });

      expect([first.sent, second.sent, third.sent, fourth.sent]).toEqual([2, 2, 1, 0]);
    });
  });

  describe("crash recovery", () => {
    it("leaves a live worker's claim alone and reclaims a dead one's", async () => {
      const { churchId, outboxIds } = await queueMany(2);
      const [live, dead] = outboxIds;

      await db
        .update(messageOutbox)
        .set({ status: "sending", lockedAt: new Date(), lockedBy: "busy-worker" })
        .where(eq(messageOutbox.id, live));
      await db
        .update(messageOutbox)
        .set({
          status: "sending",
          lockedAt: new Date(Date.now() - 30 * 60_000),
          lockedBy: "dead-worker",
        })
        .where(eq(messageOutbox.id, dead));

      const { client, calls } = scriptedClient();
      const report = await drain(churchId, client, { staleClaimMinutes: 10 });

      expect(report.releasedStale).toBe(1);
      expect(report.sent).toBe(1);
      expect(calls[0].body.Messages[0].CustomID).toBe(outboxCustomId(churchId, dead));

      const [stillHeld] = await db
        .select({ status: messageOutbox.status, lockedBy: messageOutbox.lockedBy })
        .from(messageOutbox)
        .where(eq(messageOutbox.id, live));
      expect(stillHeld).toEqual({ status: "sending", lockedBy: "busy-worker" });
    });
  });

  describe("retry schedule", () => {
    it("doubles the wait and caps it at an hour", () => {
      expect([1, 2, 3, 4, 5, 6, 10].map(backoffMinutes)).toEqual([2, 4, 8, 16, 32, 60, 60]);
    });

    it("stops after the last allowed attempt and marks the record failed", async () => {
      const { churchId, outboxIds } = await queueMany(1);
      const [outboxId] = outboxIds;

      // One attempt left.
      await db
        .update(messageOutbox)
        .set({ attempts: MAX_SEND_ATTEMPTS - 1, nextAttemptAt: new Date(0) })
        .where(eq(messageOutbox.id, outboxId));

      const { client, calls } = scriptedClient([{ status: 503, body: { message: "down" } }]);
      const report = await drain(churchId, client);
      expect(report.failed).toBe(1);
      expect(report.retrying).toBe(0);

      // And a later pass does not touch it again.
      const again = await drain(churchId, client);
      expect(again.claimed).toBe(0);
      expect(calls).toHaveLength(1);

      const [row] = await db.select().from(messageOutbox).where(eq(messageOutbox.id, outboxId));
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(MAX_SEND_ATTEMPTS);

      const failures = await recentFailures(db, churchId);
      expect(failures.map((entry) => entry.outboxId)).toEqual([outboxId]);
      expect(failures[0].lastError).toContain("503");
    });

    it("waits out a 429 instead of hammering the provider", async () => {
      const { churchId } = await queueMany(1);
      const { client, calls } = scriptedClient([{ status: 429, body: {} }]);

      const first = await drain(churchId, client);
      const second = await drain(churchId, client);

      expect(first.retrying).toBe(1);
      // Not due yet: the backoff has pushed it into the future.
      expect(second.claimed).toBe(0);
      expect(calls).toHaveLength(1);
    });
  });

  describe("failure injection", () => {
    it("keeps going when one message in a batch fails", async () => {
      const { churchId } = await queueMany(3);
      // First call: connection dropped. The rest: fine.
      const { client, calls } = scriptedClient(["throw", { status: 200 }]);

      const report = await drain(churchId, client);

      expect(calls).toHaveLength(3);
      expect(report).toMatchObject({ claimed: 3, sent: 2, retrying: 1, failed: 0 });
    });

    it("sends the retried message once the provider recovers", async () => {
      const { churchId, outboxIds } = await queueMany(1);
      const { client, calls } = scriptedClient([{ status: 502, body: {} }, { status: 200 }]);

      expect((await drain(churchId, client)).retrying).toBe(1);

      // Time passes.
      await db
        .update(messageOutbox)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(messageOutbox.id, outboxIds[0]));

      const recovered = await drain(churchId, client);
      expect(recovered.sent).toBe(1);
      expect(calls).toHaveLength(2);

      const [row] = await db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.id, outboxIds[0]));
      expect(row.status).toBe("sent");
      expect(row.attempts).toBe(2);
      expect(row.lastError).toBeNull();
    });

    it("treats a per-message rejection in a 200 as permanent", async () => {
      const { churchId, outboxIds } = await queueMany(1);
      const { client } = scriptedClient([
        {
          status: 200,
          body: { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Invalid email" }] }] },
        },
      ]);

      const report = await drain(churchId, client);
      expect(report.failed).toBe(1);

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, (await outboxRow(outboxIds[0])).communicationId));
      expect(record.status).toBe("failed");
    });
  });

  describe("bounces", () => {
    async function sentMessage() {
      const context = await queueMany(1);
      const { client } = scriptedClient();
      await drain(context.churchId, client);
      return { ...context, outboxId: context.outboxIds[0] };
    }

    it("suppresses and opts out on a hard bounce", async () => {
      const { churchId, outboxId, person } = await sentMessage();

      const applied = await applyEvents(db, [
        {
          event: "bounce",
          CustomID: outboxCustomId(churchId, outboxId),
          time: 1,
          email: person.email,
          hard_bounce: true,
          blocked: true,
          error_related_to: "recipient",
          error: "user unknown",
        },
      ]);

      expect(applied.ok && applied.value.optOut).toHaveLength(1);
      expect(await suppressed(churchId, person.email!)).toBe(true);
      expect((await communicationStatus(outboxId))).toBe("bounced");
    });

    it("records a soft bounce without cutting the person off", async () => {
      const { churchId, outboxId, person } = await sentMessage();

      const applied = await applyEvents(db, [
        {
          event: "bounce",
          CustomID: outboxCustomId(churchId, outboxId),
          time: 2,
          email: person.email,
          hard_bounce: false,
          blocked: false,
          error_related_to: "recipient",
          error: "quota exceeded",
        },
      ]);

      expect(applied.ok && applied.value.applied).toBe(1);
      // The message did not arrive, and the record says so...
      expect(await communicationStatus(outboxId)).toBe("bounced");
      // ...but a full mailbox is not a reason to never write again.
      expect(applied.ok && applied.value.optOut).toHaveLength(0);
      expect(await suppressed(churchId, person.email!)).toBe(false);

      // A later send to the same person is still allowed.
      const context = await seededChurch(db, churchId);
      const again = await sendTemplatedEmail(
        db,
        context.session,
        { personId: person.id, templateId: context.template.id, ...SEND_CONTEXT },
        { limits: { perPersonCooldownMinutes: 0 } },
      );
      expect(again.ok).toBe(true);
    });

    it("suppresses a block the provider applied to protect the sender", async () => {
      const { churchId, outboxId, person } = await sentMessage();

      const applied = await applyEvents(db, [
        {
          event: "blocked",
          CustomID: outboxCustomId(churchId, outboxId),
          time: 3,
          email: person.email,
          error_related_to: "mailjet",
          error: "preblocked",
        },
      ]);

      expect(applied.ok && applied.value.optOut[0]?.reason).toContain("bounced before");
      expect(await suppressed(churchId, person.email!)).toBe(true);
    });

    it("does not blame the recipient for a block caused by our content", async () => {
      const { churchId, outboxId, person } = await sentMessage();

      const applied = await applyEvents(db, [
        {
          event: "blocked",
          CustomID: outboxCustomId(churchId, outboxId),
          time: 4,
          email: person.email,
          error_related_to: "content",
          error: "error in template language",
        },
      ]);

      expect(applied.ok && applied.value.applied).toBe(1);
      expect(applied.ok && applied.value.optOut).toHaveLength(0);
      expect(await suppressed(churchId, person.email!)).toBe(false);
      expect(await communicationStatus(outboxId)).toBe("blocked");
    });
  });

  describe("unsubscribe", () => {
    it("opts the person out, suppresses the address and cancels their work", async () => {
      const { churchId, person } = await queueMany(1);

      const first = await applyUnsubscribe(db, { churchId, personId: person.id });
      expect(first.ok && first.value.changed).toBe(true);

      const reloaded = await createPostgresSnapshotRepository({
        db,
        churchId,
        createSeed: seed,
      }).load(FULL_SCOPE);
      const updated = reloaded.snapshot.people.find((entry) => entry.id === person.id);
      expect(updated?.contact.optedOut).toBe(true);
      expect(updated?.contact.optOutReason).toContain("unsubscribed");

      const open = reloaded.snapshot.tasks.filter(
        (task) =>
          task.personId === person.id &&
          task.type !== "pastoral_contact" &&
          ["pending", "in_progress", "rescheduled"].includes(task.status),
      );
      expect(open).toHaveLength(0);
      expect(await suppressed(churchId, person.email!)).toBe(true);

      // One-click clients and link scanners may hit the URL more than once.
      const second = await applyUnsubscribe(db, { churchId, personId: person.id });
      expect(second.ok && second.value.changed).toBe(false);
    });

    it("treats a person who no longer exists as already done", async () => {
      const { churchId } = await church();
      const outcome = await applyUnsubscribe(db, { churchId, personId: "nobody" });
      expect(outcome.ok && outcome.value.changed).toBe(false);
    });

    it("refuses a queued message to somebody who unsubscribed before it was sent", async () => {
      const { churchId, person, outboxIds } = await queueMany(1);
      await applyUnsubscribe(db, { churchId, personId: person.id });

      const { client, calls } = scriptedClient();
      const report = await drain(churchId, client);

      expect(calls).toHaveLength(0);
      expect(report).toMatchObject({ claimed: 1, sent: 0, refused: 1 });
      expect(await communicationStatus(outboxIds[0])).toBe("blocked");
    });

    it("refuses a queued message outside a pilot that started after it was queued", async () => {
      const { churchId, outboxIds } = await queueMany(2);
      const { client, calls } = scriptedClient();
      const report = await drain(churchId, client, { allowlist: ["pilot@example.com"] });

      expect(calls).toHaveLength(0);
      expect(report.refused).toBe(2);
      const [row] = await db.select().from(messageOutbox).where(eq(messageOutbox.id, outboxIds[0]));
      expect(row.lastError).toContain("pilot allowlist");
    });
  });

  describe("status ordering", () => {
    it("never lets a late report move a message backwards", async () => {
      const { churchId, outboxIds, person } = await queueMany(1);
      const { client } = scriptedClient();
      await drain(churchId, client);
      const customId = outboxCustomId(churchId, outboxIds[0]);

      await applyEvents(db, [
        { event: "bounce", CustomID: customId, time: 10, email: person.email, hard_bounce: true },
      ]);
      expect(await communicationStatus(outboxIds[0])).toBe("bounced");

      // A "sent" that was delayed in the provider's queue arrives afterwards.
      await applyEvents(db, [{ event: "sent", CustomID: customId, time: 9, email: person.email }]);
      expect(await communicationStatus(outboxIds[0])).toBe("bounced");

      // A bounce is not a failure to send: the operator's retry list stays clean.
      const [row] = await db.select().from(messageOutbox).where(eq(messageOutbox.id, outboxIds[0]));
      expect(row.status).toBe("bounced");
      expect(await recentFailures(db, churchId)).toHaveLength(0);
    });

    it("keeps the webhook's delivered over the worker's later sent", async () => {
      const { churchId, outboxIds, person } = await queueMany(1);
      // The webhook wins the race: it reports delivery before the worker has
      // written "sent".
      const customId = outboxCustomId(churchId, outboxIds[0]);
      await applyEvents(db, [{ event: "sent", CustomID: customId, time: 11, email: person.email }]);
      expect(await communicationStatus(outboxIds[0])).toBe("delivered");

      // The row is still pending as far as the queue knows; the worker sends
      // and must not demote the record.
      const { client } = scriptedClient();
      await drain(churchId, client);
      expect(await communicationStatus(outboxIds[0])).toBe("delivered");
    });
  });

  describe("webhook inbox and health", () => {
    it("keeps every delivery, with its outcome or its failure", async () => {
      const body = [{ event: "open", time: 5 }];
      const inboxId = await recordDelivery(db, body, body.length);
      await recordOutcome(db, inboxId, { applied: 0, ignored: 1, duplicates: 0, optedOut: 0 });

      const [row] = await db.select().from(webhookInbox).where(eq(webhookInbox.id, inboxId));
      expect(row.body).toEqual(body);
      expect(row.events).toBe(1);
      expect(row.ignored).toBe(1);
      expect(row.processedAt).not.toBeNull();
      expect(row.error).toBeNull();

      const failedId = await recordDelivery(db, { event: "bounce" }, 1);
      await recordFailure(db, failedId, new Error("database went away"));
      const [failed] = await db.select().from(webhookInbox).where(eq(webhookInbox.id, failedId));
      expect(failed.error).toBe("database went away");

      const health = await emailHealth(db);
      expect(health.webhookFailures).toBeGreaterThanOrEqual(1);
      expect(health.lastWebhookAt).not.toBeNull();

      await db.delete(webhookInbox).where(inArray(webhookInbox.id, [inboxId, failedId]));
    });

    it("reports the queue as numbers an operator can alert on", async () => {
      const { churchId, outboxIds } = await queueMany(3);
      const [failing] = outboxIds;
      await db
        .update(messageOutbox)
        .set({ status: "failed", lastError: "gave up" })
        .where(eq(messageOutbox.id, failing));

      const before = await emailHealth(db, churchId);
      expect(before.outbox).toMatchObject({ pending: 2, failed: 1, sent: 0, overdue: 2 });
      expect(before.outbox.oldestPendingSeconds).not.toBeNull();

      const { client } = scriptedClient();
      await drain(churchId, client);

      const after = await emailHealth(db, churchId);
      expect(after.outbox).toMatchObject({ pending: 0, sent: 2, failed: 1 });
      expect(after.outbox.oldestPendingSeconds).toBeNull();
    });

    it("prunes old deliveries and keeps recent ones", async () => {
      const recent = await recordDelivery(db, { event: "sent" }, 1);
      const old = await recordDelivery(db, { event: "sent" }, 1);
      await db
        .update(webhookInbox)
        .set({ receivedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000) })
        .where(eq(webhookInbox.id, old));

      expect(await pruneWebhookInbox(db, 30)).toBeGreaterThanOrEqual(1);

      const remaining = await db
        .select({ id: webhookInbox.id })
        .from(webhookInbox)
        .where(inArray(webhookInbox.id, [recent, old]));
      expect(remaining.map((row) => row.id)).toEqual([recent]);

      await db.delete(webhookInbox).where(eq(webhookInbox.id, recent));
    });
  });

  describe("what gets sent", () => {
    it("sends the sender's edited wording rather than the template", async () => {
      const { churchId, session, person, template } = await church();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        subject: "  Lovely to meet you  ",
        body: "Hello from the welcome team.\n\nSee you Sunday.",
      });
      if (!queued.ok) throw new Error(queued.error);

      const row = await outboxRow(queued.value.outboxId);
      expect(row.subject).toBe("Lovely to meet you");
      expect(row.textPart).toBe("Hello from the welcome team.\n\nSee you Sunday.");
      expect(row.htmlPart).toContain("<p>Hello from the welcome team.</p>");
      void churchId;
    });

    it("refuses an edited message that still has a placeholder in it", async () => {
      const { session, person, template } = await church();
      const outcome = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        body: "Hi {{firstName}}, welcome!",
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("incomplete");
    });

    it("will not write to the same person twice in quick succession", async () => {
      const { session, person, template } = await church();
      const input = { personId: person.id, templateId: template.id, ...SEND_CONTEXT };

      expect((await sendTemplatedEmail(db, session, input)).ok).toBe(true);

      const again = await sendTemplatedEmail(db, session, input);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe(RATE_LIMITED);
    });

    it("caps how much one church can queue in an hour", async () => {
      const { session, person, template } = await church();
      const input = { personId: person.id, templateId: template.id, ...SEND_CONTEXT };
      const limits = { perChurchPerHour: 2, perPersonCooldownMinutes: 0 };

      expect((await sendTemplatedEmail(db, session, input, { limits })).ok).toBe(true);
      expect((await sendTemplatedEmail(db, session, input, { limits })).ok).toBe(true);

      const third = await sendTemplatedEmail(db, session, input, { limits });
      expect(third.ok).toBe(false);
      if (!third.ok) expect(third.code).toBe(RATE_LIMITED);
    });

    it("refuses anybody outside the pilot allowlist, and allows those on it", async () => {
      const { session, person, template } = await church();

      const refused = await sendTemplatedEmail(
        db,
        session,
        { personId: person.id, templateId: template.id, ...SEND_CONTEXT },
        { allowlist: ["pilot@example.com"] },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe(NOT_IN_PILOT);

      const allowed = await sendTemplatedEmail(
        db,
        session,
        { personId: person.id, templateId: template.id, ...SEND_CONTEXT },
        { allowlist: [person.email!.toUpperCase()], limits: { perPersonCooldownMinutes: 0 } },
      );
      expect(allowed.ok).toBe(true);
    });
  });

  async function outboxRow(id: string) {
    const [row] = await db.select().from(messageOutbox).where(eq(messageOutbox.id, id));
    return row;
  }

  async function communicationStatus(outboxId: string) {
    const row = await outboxRow(outboxId);
    const [record] = await db
      .select({ status: communications.status })
      .from(communications)
      .where(eq(communications.id, row.communicationId));
    return record.status;
  }

  async function suppressed(churchId: string, email: string) {
    const rows = await db
      .select()
      .from(emailSuppression)
      .where(eq(emailSuppression.churchId, churchId));
    return rows.some((row) => row.email === email.toLowerCase());
  }
});

describe("suppression rules", () => {
  it("follows the provider's own advice on which events end the relationship", () => {
    expect(shouldSuppress({ event: "spam" })).toBe(true);
    expect(shouldSuppress({ event: "unsub" })).toBe(true);
    expect(shouldSuppress({ event: "bounce", hard_bounce: true })).toBe(true);
    expect(shouldSuppress({ event: "bounce", hard_bounce: false, blocked: true })).toBe(true);
    expect(shouldSuppress({ event: "bounce", hard_bounce: false })).toBe(false);
    expect(shouldSuppress({ event: "blocked", error: "preblocked" })).toBe(true);
    expect(shouldSuppress({ event: "blocked", error: "spam reporter" })).toBe(true);
    expect(shouldSuppress({ event: "blocked", error: "duplicate in campaign" })).toBe(false);
    expect(shouldSuppress({ event: "blocked", error_related_to: "system", error: "system issue" })).toBe(false);
    expect(shouldSuppress({ event: "blocked", error_related_to: "domain", error: "greylisted" })).toBe(false);
    expect(shouldSuppress({ event: "sent" })).toBe(false);
    expect(shouldSuppress({ event: "open" })).toBe(false);
  });
});

describe("configuration and the production gate", () => {
  const full: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    MAILJET_API_KEY: "k",
    MAILJET_SECRET_KEY: "s",
    MAILJET_FROM_EMAIL: "hello@church.example",
    MAILJET_WEBHOOK_SECRET: "w",
    BETTER_AUTH_SECRET: "auth-secret",
    BETTER_AUTH_URL: "https://church.example.com",
  };

  const empty: NodeJS.ProcessEnv = { NODE_ENV: "test" };

  it("is unavailable with no credentials, and says which are missing", () => {
    const config = readMailjetConfig(empty);
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.code).toBe(NOT_CONFIGURED);
      expect(config.error).toContain("apiKey");
    }
    expect(emailAvailability(empty)).toMatchObject({ configured: false, enabled: false });
  });

  it("is configured but not offered until the gate is opened", () => {
    expect(emailAvailability(full)).toMatchObject({ configured: true, enabled: false });

    const config = readMailjetConfig(full);
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    const gated = assertSendingEnabled(config.value);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.code).toBe(NOT_ENABLED);

    for (const value of ["true", "1", "yes", "ON"]) {
      expect(emailAvailability({ ...full, EMAIL_SENDING_ENABLED: value }).enabled, value).toBe(true);
    }
    for (const value of ["false", "0", "", "maybe"]) {
      expect(emailAvailability({ ...full, EMAIL_SENDING_ENABLED: value }).enabled, value).toBe(false);
    }
  });

  it("reads the pilot allowlist and reports a pilot is in force", () => {
    const config = readMailjetConfig({
      ...full,
      EMAIL_SENDING_ENABLED: "true",
      EMAIL_PILOT_ALLOWLIST: "One@Example.com, two@example.com\nthree@example.com",
    });
    expect(config.ok && config.value.pilotAllowlist).toEqual([
      "one@example.com",
      "two@example.com",
      "three@example.com",
    ]);
    expect(
      emailAvailability({ ...full, EMAIL_SENDING_ENABLED: "true", EMAIL_PILOT_ALLOWLIST: "a@b.c" })
        .pilot,
    ).toBe(true);

    // Set but empty is a mistake, not "no pilot".
    const broken = readMailjetConfig({ ...full, EMAIL_PILOT_ALLOWLIST: " , " });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.code).toBe(NOT_CONFIGURED);
  });

  it("prefers a dedicated unsubscribe secret and falls back to the auth secret", () => {
    const fallback = readMailjetConfig(full);
    expect(fallback.ok && fallback.value.unsubscribeSecret).toBe("auth-secret");
    const dedicated = readMailjetConfig({ ...full, UNSUBSCRIBE_SECRET: "links" });
    expect(dedicated.ok && dedicated.value.unsubscribeSecret).toBe("links");
    expect(readMailjetConfig({ ...full, BETTER_AUTH_SECRET: undefined }).ok).toBe(false);
  });

  it("lets a stub stand in for the real API", () => {
    const config = readMailjetConfig({ ...full, MAILJET_SEND_URL: "http://localhost:9/send" });
    expect(config.ok && config.value.sendUrl).toBe("http://localhost:9/send");
    const real = readMailjetConfig(full);
    expect(real.ok && real.value.sendUrl).toBeUndefined();
  });
});
