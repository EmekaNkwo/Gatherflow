// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { setContactPreferences } from "@/services/visitors/pipeline";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import type { ChurchSession } from "@/server/auth/session";
import { runSystemCommand } from "@/server/church/commands";
import { createDatabase, type Database } from "@/server/db/client";
import {
  churches,
  communications,
  emailSuppression,
  messageOutbox,
  webhookEvents,
} from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import {
  createMailjetClient,
  isRetryable,
  MAILJET_SEND_URL,
  type MailjetTransport,
} from "./mailjet";
import { isSuppressed, outboxCustomId, parseCustomId, unsubscribeUrl } from "./outbox";
import { sendTemplatedEmail, toHtml } from "./send-command";
import { drainOutbox } from "./worker";
import { applyEvents, constantTimeEquals, eventKey, parseEventPayload } from "./webhook";

/**
 * The email pipeline, against a real Postgres and a fake provider.
 *
 * The provider is injected rather than mocked at the network layer, so these
 * tests exercise the real request building and response handling without
 * sending anything to anybody.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;

/**
 * The context a caller supplies for whichever template it chose. The composer
 * does the same; these tests are about the pipeline, not the wording, so they
 * fill everything in and let the placeholder check pass.
 */
const SEND_CONTEXT = {
  serviceName: "our Sunday service",
  serviceDate: "2026-10-11",
  groupName: "Tuesday connect group",
} as const;
const NOW = new Date("2026-10-12T09:00:00.000Z");
const seed = () => createSeedSnapshot(NOW);

let db: Database;
let counter = 0;
const created: string[] = [];

function nextChurchId(): string {
  counter += 1;
  const id = `email-church-${process.pid}-${counter}`;
  created.push(id);
  return id;
}

/** A provider that records what it was asked to do and answers as told. */
function fakeTransport(
  responses: Array<{ status: number; body?: unknown } | "throw">,
): { transport: MailjetTransport; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  let index = 0;

  const transport: MailjetTransport = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response === "throw") throw new Error("socket hang up");
    return {
      status: response.status,
      json: async () =>
        response.body ?? {
          Messages: [
            {
              Status: "success",
              To: [{ Email: "x@example.com", MessageID: 123, MessageUUID: "uuid-1" }],
            },
          ],
        },
    };
  };

  return { transport, calls };
}

function okClient(responses?: Array<{ status: number; body?: unknown } | "throw">) {
  const { transport, calls } = fakeTransport(responses ?? [{ status: 200 }]);
  return {
    client: createMailjetClient(
      {
        apiKey: "key",
        secretKey: "secret",
        fromEmail: "hello@example.com",
        fromName: "Test Church",
      },
      transport,
    ),
    calls,
  };
}

/** Seeds a church and returns a contactable person plus an email template. */
async function churchWithContactablePerson() {
  const churchId = nextChurchId();
  const repository = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
  const loaded = await repository.load();

  const person = loaded.snapshot.people.find(
    (candidate) =>
      candidate.contact.permissionGranted && !candidate.contact.optedOut && candidate.email,
  );
  expect(person, "the seed should contain a contactable person with an email").toBeDefined();

  const template = loaded.snapshot.templates.find((entry) =>
    entry.channels.includes("email"),
  );
  expect(template).toBeDefined();

  const session: ChurchSession = {
    userId: `user-${churchId}`,
    churchId,
    role: "follow_up_coordinator",
    teamMemberId: loaded.snapshot.team[0]?.id ?? null,
  };

  return { churchId, repository, session, person: person!, template: template!, loaded };
}

describe.skipIf(!CONNECTION)("email pipeline", () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });

  afterAll(async () => {
    for (const id of created) {
      await db.delete(churches).where(eq(churches.id, id));
    }
  });

  describe("queueing", () => {
    it("writes the record and the queue row together", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();

      const outcome = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const [row] = await db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.id, outcome.value.outboxId));
      expect(row).toBeDefined();
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
      expect(row.toEmail).toBe(person.email!.toLowerCase());
      expect(row.customId).toBe(outboxCustomId(churchId, outcome.value.outboxId));

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, outcome.value.communicationId));
      expect(record).toBeDefined();
      expect(record.status).toBe("queued");
      // A real send, not a draft; the interface badges the two differently.
      expect(record.data.simulated).toBe(false);
    });

    it("refuses somebody who opted out, and queues nothing", async () => {
      const { churchId, session, person, template, loaded, repository } =
        await churchWithContactablePerson();

      const optedOut = setContactPreferences(
        loaded.snapshot,
        { personId: person.id, optedOut: true, optOutReason: "asked not to be contacted" },
        { ...contextFor(), actorId: session.teamMemberId ?? "tm" },
      );
      expect(optedOut.ok).toBe(true);
      if (!optedOut.ok) return;
      await repository.save(loaded.snapshot, optedOut.value.snapshot, loaded.version);

      const outcome = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("opted_out");

      const queued = await db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.churchId, churchId));
      expect(queued).toHaveLength(0);
    });

    it("refuses an address on the suppression list", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();

      await db.insert(emailSuppression).values({
        churchId,
        email: person.email!.toLowerCase(),
        reason: "bounced",
      });

      const outcome = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("suppressed");
    });

    it("refuses a role without communications.write", async () => {
      const { session, person, template } = await churchWithContactablePerson();

      const outcome = await sendTemplatedEmail(
        db,
        { ...session, role: "member" },
        { personId: person.id, templateId: template.id, ...SEND_CONTEXT },
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("forbidden");
    });

    it("rolls the whole commit back when the queue row cannot be written", async () => {
      // The point of the transactional outbox: a record must never be
      // committed without the message it promised, nor the other way round.
      const { repository, loaded, churchId: id } = await churchWithContactablePerson();

      const renamed = {
        ...loaded.snapshot,
        settings: { ...loaded.snapshot.settings, churchName: "Should Not Persist" },
      };

      const saved = await repository.save(loaded.snapshot, renamed, loaded.version, {
        enlist: async () => {
          throw new Error("queue write failed");
        },
      });

      expect(saved.ok).toBe(false);
      if (!saved.ok) expect(saved.code).toBe("storage_failed");

      const reloaded = await createPostgresSnapshotRepository({
        db,
        churchId: id,
        createSeed: seed,
      }).load(FULL_SCOPE);

      expect(reloaded.snapshot.settings.churchName).not.toBe("Should Not Persist");
      expect(reloaded.version).toBe(loaded.version);
    });
  });

  describe("the worker", () => {
    it("sends a queued message and records the provider's ids", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      const { client, calls } = okClient();
      const report = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "test",
        churchId,
      });

      expect(report.sent).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(MAILJET_SEND_URL);

      const sent = calls[0].body as {
        Messages: Array<{
          To: Array<{ Email: string }>;
          CustomID: string;
          Headers: Record<string, string>;
        }>;
      };
      expect(sent.Messages[0].To[0].Email).toBe(person.email!.toLowerCase());
      expect(sent.Messages[0].CustomID).toBe(outboxCustomId(churchId, queued.value.outboxId));
      // Every send carries a way out, matching the opt-in it relies on.
      expect(sent.Messages[0].Headers["List-Unsubscribe"]).toContain("/unsubscribe");

      const [row] = await db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.id, queued.value.outboxId));
      expect(row.status).toBe("sent");
      expect(row.mailjetMessageId).toBe("123");
      expect(row.mailjetMessageUuid).toBe("uuid-1");

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, queued.value.communicationId));
      // "sent" only: the provider took it. Delivery is the webhook's word.
      expect(record.status).toBe("sent");
    });

    it("retries a 500 later instead of giving up", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      const now = new Date();
      const { client } = okClient([{ status: 500, body: { message: "upstream" } }]);
      const report = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "test",
        churchId,
      });

      expect(report.retrying).toBe(1);
      expect(report.failed).toBe(0);

      const [row] = await db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.id, queued.value.outboxId));
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
      expect(row.lastError).toContain("500");
    });

    it("gives up immediately on a 400, because repeating it cannot help", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      const { client } = okClient([{ status: 400, body: { message: "bad address" } }]);
      const report = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "test",
        churchId,
      });

      expect(report.failed).toBe(1);

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, queued.value.communicationId));
      expect(record.status).toBe("failed");
    });

    it("does not claim the same row twice", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      const { client, calls } = okClient();
      const first = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "a",
        churchId,
      });
      const second = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "b",
        churchId,
      });

      expect(first.claimed).toBe(1);
      expect(second.claimed).toBe(0);
      expect(calls).toHaveLength(1);
    });

    it("reclaims a row abandoned by a dead worker", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      // A worker that claimed the row and then died.
      await db
        .update(messageOutbox)
        .set({
          status: "sending",
          lockedAt: new Date(Date.now() - 60 * 60_000),
          lockedBy: "dead",
        })
        .where(eq(messageOutbox.id, queued.value.outboxId));

      const { client } = okClient();
      const report = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "fresh",
        churchId,
      });

      expect(report.releasedStale).toBeGreaterThanOrEqual(1);
      expect(report.sent).toBe(1);
    });

    it("treats a transport failure as retryable", async () => {
      const { churchId, session, person, template } = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, session, {
        personId: person.id,
        templateId: template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      const { client } = okClient(["throw"]);
      const report = await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "test",
        churchId,
      });

      expect(report.retrying).toBe(1);
    });
  });

  describe("provider events", () => {
    async function queuedAndSent() {
      const context = await churchWithContactablePerson();
      const queued = await sendTemplatedEmail(db, context.session, {
        personId: context.person.id,
        templateId: context.template.id,
        ...SEND_CONTEXT,
      });
      if (!queued.ok) throw new Error(queued.error);

      const { client } = okClient();
      await drainOutbox({
        db,
        mailjet: client,
        appUrl: "https://church.example.com",
        workerId: "test",
        churchId: context.churchId,
      });

      return { ...context, queued: queued.value };
    }

    it("records delivery when the receiving server accepted the message", async () => {
      const { churchId, queued } = await queuedAndSent();

      const applied = await applyEvents(db, [
        {
          event: "sent",
          CustomID: outboxCustomId(churchId, queued.outboxId),
          MessageID: 123,
          time: 1_760_000_000,
          email: queued.toEmail,
        },
      ]);

      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.applied).toBe(1);
      expect(applied.value.optOut).toHaveLength(0);

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, queued.communicationId));
      expect(record.status).toBe("delivered");
    });

    it("suppresses the address and asks for an opt-out on a hard bounce", async () => {
      const { churchId, queued, person } = await queuedAndSent();

      const applied = await applyEvents(db, [
        {
          event: "bounce",
          CustomID: outboxCustomId(churchId, queued.outboxId),
          MessageID: 123,
          time: 1_760_000_001,
          email: queued.toEmail,
          hard_bounce: true,
          error: "user unknown",
        },
      ]);

      expect(applied.ok).toBe(true);
      if (!applied.ok) return;

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, queued.communicationId));
      expect(record.status).toBe("bounced");

      expect(await isSuppressed(db, churchId, queued.toEmail)).toBe(true);
      expect(applied.value.optOut).toEqual([
        {
          churchId,
          personId: person.id,
          reason: "Their email address does not exist.",
        },
      ]);
    });

    it("ignores a repeat of the same event", async () => {
      const { churchId, queued } = await queuedAndSent();
      const event = {
        event: "spam" as const,
        CustomID: outboxCustomId(churchId, queued.outboxId),
        MessageID: 123,
        time: 1_760_000_002,
        email: queued.toEmail,
      };

      const first = await applyEvents(db, [event]);
      const second = await applyEvents(db, [event]);

      expect(first.ok && first.value.applied).toBe(1);
      expect(second.ok && second.value.duplicates).toBe(1);
      expect(second.ok && second.value.applied).toBe(0);
      // And no second opt-out request from the replay.
      expect(second.ok && second.value.optOut).toHaveLength(0);
    });

    it("ignores an event naming a message it does not have, creating nothing", async () => {
      const before = await db.select().from(webhookEvents);

      const applied = await applyEvents(db, [
        {
          event: "bounce",
          CustomID: "some-other-church:made-up-id",
          MessageID: 999_999,
          time: 1_760_000_003,
          email: "stranger@example.com",
        },
      ]);

      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.applied).toBe(0);
      expect(applied.value.ignored).toBe(1);
      expect(applied.value.optOut).toHaveLength(0);

      const after = await db.select().from(webhookEvents);
      expect(after.length).toBe(before.length);

      const suppressed = await db
        .select()
        .from(emailSuppression)
        .where(eq(emailSuppression.email, "stranger@example.com"));
      expect(suppressed).toHaveLength(0);
    });

    it("does not record opens or clicks at all", async () => {
      const { churchId, queued } = await queuedAndSent();

      const applied = await applyEvents(db, [
        {
          event: "open",
          CustomID: outboxCustomId(churchId, queued.outboxId),
          time: 1_760_000_004,
        },
        {
          event: "click",
          CustomID: outboxCustomId(churchId, queued.outboxId),
          time: 1_760_000_005,
        },
      ]);

      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.ignored).toBe(2);
      expect(applied.value.applied).toBe(0);

      const [record] = await db
        .select()
        .from(communications)
        .where(eq(communications.id, queued.communicationId));
      // Still what the provider last actually told us about delivery.
      expect(record.status).toBe("sent");
    });

    it("opts the person out through the domain rules, cancelling their open work", async () => {
      const { churchId, queued, person } = await queuedAndSent();

      const applied = await applyEvents(db, [
        {
          event: "unsub",
          CustomID: outboxCustomId(churchId, queued.outboxId),
          MessageID: 123,
          time: 1_760_000_006,
          email: queued.toEmail,
        },
      ]);
      if (!applied.ok) throw new Error(applied.error);

      for (const target of applied.value.optOut) {
        const outcome = await runSystemCommand(db, target.churchId, (snapshot, ctx) =>
          setContactPreferences(
            snapshot,
            { personId: target.personId, optedOut: true, optOutReason: target.reason },
            ctx,
          ),
        );
        expect(outcome.ok).toBe(true);
      }

      const reloaded = await createPostgresSnapshotRepository({
        db,
        churchId,
        createSeed: seed,
      }).load(FULL_SCOPE);

      const updated = reloaded.snapshot.people.find((entry) => entry.id === person.id);
      expect(updated?.contact.optedOut).toBe(true);
      expect(updated?.contact.permissionGranted).toBe(false);

      // Opt-out cancels open follow-up work; going through the command rather
      // than writing the flag directly is what preserves that.
      const stillOpen = reloaded.snapshot.tasks.filter(
        (task) =>
          task.personId === person.id &&
          task.type !== "pastoral_contact" &&
          ["pending", "in_progress", "rescheduled"].includes(task.status),
      );
      expect(stillOpen).toHaveLength(0);
    });
  });
});

describe("email helpers", () => {
  it("compares secrets without leaking their length", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcdef")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });

  it("treats 5xx, 429 and 408 as worth retrying, and other 4xx as not", () => {
    for (const status of [500, 502, 503, 429, 408]) {
      expect(isRetryable(status), String(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryable(status), String(status)).toBe(false);
    }
  });

  it("accepts a single event or a grouped array, and rejects anything else", () => {
    expect(parseEventPayload({ event: "sent" })).toHaveLength(1);
    expect(parseEventPayload([{ event: "sent" }, { event: "bounce" }])).toHaveLength(2);
    expect(parseEventPayload([{ event: "sent" }, { nope: true }])).toHaveLength(1);
    for (const value of [null, undefined, "sent", 42, {}, []]) {
      expect(parseEventPayload(value)).toHaveLength(0);
    }
  });

  it("gives the same event the same key and different events different keys", () => {
    const base = { event: "bounce", MessageID: 1, time: 100, email: "a@example.com" };
    expect(eventKey(base)).toBe(eventKey({ ...base }));
    expect(eventKey(base)).not.toBe(eventKey({ ...base, time: 101 }));
    expect(eventKey(base)).not.toBe(eventKey({ ...base, event: "spam" }));
  });

  it("round-trips a custom id and rejects malformed ones", () => {
    expect(parseCustomId(outboxCustomId("church-1", "out-1"))).toEqual({
      churchId: "church-1",
      outboxId: "out-1",
    });
    for (const value of [null, undefined, "", "nocolon", ":missing", "trailing:"]) {
      expect(parseCustomId(value), String(value)).toBeNull();
    }
  });

  it("escapes the message body so a name cannot inject markup", () => {
    const html = toHtml('Hi <script>alert("x")</script> & welcome');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("builds an unsubscribe link without doubling the slash", () => {
    expect(unsubscribeUrl("https://a.example.com/", "c1", "p1")).toBe(
      "https://a.example.com/unsubscribe?church=c1&person=p1",
    );
  });
});

/** A minimal context for the few places a test drives a command directly. */
function contextFor() {
  return {
    now: NOW,
    nowIso: NOW.toISOString(),
    today: "2026-10-12",
    id: (prefix: string) => `${prefix}_test_${(counter += 1)}`,
    actorId: "tm_admin_ruth",
  };
}
