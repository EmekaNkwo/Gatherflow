// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ok } from "@/lib/result";
import { task } from "@/tests/factories";
import { createDatabase, type Database } from "@/server/db/client";
import { churches, pushSubscriptions, user } from "@/server/db/schema";
import { getAuth } from "@/server/auth/auth";
import { createChurchForUser } from "@/server/auth/churches";
import { runSystemCommand } from "@/server/church/commands";
import { sendDailyReminders, type PushSender } from "./reminders";
import { removeSubscription, saveSubscription } from "./subscriptions";

/**
 * The daily reminder, end to end against Postgres with the push service
 * replaced by a recorder.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const TODAY = "2026-10-12";
let db: Database;
const createdChurches: string[] = [];
const createdUsers: string[] = [];

async function founder(suffix: string, churchName: string) {
  const email = `push-${process.pid}-${suffix}@example.com`;
  await getAuth().api.signUpEmail({
    body: { email, password: "correct-horse-battery-staple", name: `Person ${suffix}` },
  });
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  createdUsers.push(row.id);
  const church = await createChurchForUser(db, { userId: row.id, userName: `Person ${suffix}`, churchName });
  createdChurches.push(church.churchId);
  return { userId: row.id, ...church };
}

async function assign(churchId: string, teamMemberId: string, dueDates: string[]) {
  const outcome = await runSystemCommand(db, churchId, (snapshot) =>
    ok({
      snapshot: {
        ...snapshot,
        tasks: dueDates.map((dueDate, index) =>
          task({ id: `task_${index}`, reference: `FU-000${index}`, assigneeId: teamMemberId, createdBy: teamMemberId, dueDate }),
        ),
      },
      events: [],
      notices: [],
    }),
  );
  if (!outcome.ok) throw new Error(outcome.error);
}

function endpoint(name: string) {
  return `https://push.example.com/${process.pid}/${name}`;
}

function recorder(gone: string[] = [], failing: string[] = []) {
  const sent: Array<{ endpoint: string; payload: string }> = [];
  const send: PushSender = async (subscription, payload) => {
    if (gone.includes(subscription.endpoint)) return { ok: false, gone: true, error: "410 Gone" };
    if (failing.includes(subscription.endpoint)) return { ok: false, gone: false, error: "503" };
    sent.push({ endpoint: subscription.endpoint, payload });
    return { ok: true };
  };
  return { sent, send };
}

describe.skipIf(!CONNECTION)("daily reminders", { timeout: 90_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });
  afterAll(async () => {
    for (const id of createdChurches) await db.delete(churches).where(eq(churches.id, id));
    for (const id of createdUsers) await db.delete(user).where(eq(user.id, id));
  });

  it("sends each subscribed browser its counts once a day, and nothing when nothing is due", async () => {
    const busy = await founder("busy", "Busy Chapel");
    await assign(busy.churchId, busy.teamMemberId, [TODAY, TODAY, "2026-10-01", "2026-11-01"]);
    const idle = await founder("idle", "Idle Chapel");

    await saveSubscription(db, busy.userId, { endpoint: endpoint("busy-laptop"), keys: { p256dh: "k", auth: "a" } });
    await saveSubscription(db, busy.userId, { endpoint: endpoint("busy-phone"), keys: { p256dh: "k", auth: "a" } });
    await saveSubscription(db, idle.userId, { endpoint: endpoint("idle"), keys: { p256dh: "k", auth: "a" } });

    const first = recorder();
    await sendDailyReminders(db, { today: TODAY, send: first.send, userIds: [busy.userId, idle.userId] });
    expect(first.sent.map((entry) => entry.endpoint).sort()).toEqual([endpoint("busy-laptop"), endpoint("busy-phone")]);
    expect(JSON.parse(first.sent[0].payload)).toEqual({
      title: "GatherFlow reminders",
      body: "2 follow-ups due today, 1 overdue.",
      url: "/follow-ups/my-tasks",
    });

    // Run again the same day: already claimed, so nothing goes out twice.
    const second = recorder();
    await sendDailyReminders(db, { today: TODAY, send: second.send, userIds: [busy.userId, idle.userId] });
    expect(second.sent).toEqual([]);

    // The next day it goes again.
    const next = recorder();
    await sendDailyReminders(db, { today: "2026-10-13", send: next.send, userIds: [busy.userId] });
    expect(next.sent).toHaveLength(2);
  });

  it("forgets a browser the push service says is gone, and retries one that failed", async () => {
    const person = await founder("flaky", "Flaky Chapel");
    await assign(person.churchId, person.teamMemberId, [TODAY]);
    await saveSubscription(db, person.userId, { endpoint: endpoint("gone"), keys: { p256dh: "k", auth: "a" } });
    await saveSubscription(db, person.userId, { endpoint: endpoint("down"), keys: { p256dh: "k", auth: "a" } });

    const failing = recorder([endpoint("gone")], [endpoint("down")]);
    const report = await sendDailyReminders(db, { today: TODAY, send: failing.send, userIds: [person.userId] });
    expect(report).toMatchObject({ sent: 0, removed: 1, failed: 1 });

    const left = await db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, person.userId));
    expect(left.map((row) => row.endpoint)).toEqual([endpoint("down")]);

    // The failed one was released, so a later run the same day tries again.
    const recovered = recorder();
    await sendDailyReminders(db, { today: TODAY, send: recovered.send, userIds: [person.userId] });
    expect(recovered.sent.map((entry) => entry.endpoint)).toEqual([endpoint("down")]);
  });

  it("re-subscribing the same browser is one subscription, and only its owner can remove it", async () => {
    const owner = await founder("owner", "Owner Chapel");
    const other = await founder("other", "Other Chapel");
    const browser = { endpoint: endpoint("shared"), keys: { p256dh: "k1", auth: "a1" } };

    await saveSubscription(db, owner.userId, browser);
    await saveSubscription(db, owner.userId, { ...browser, keys: { p256dh: "k2", auth: "a2" } });
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, browser.endpoint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: owner.userId, p256dh: "k2", auth: "a2" });

    expect(await removeSubscription(db, other.userId, browser.endpoint)).toBe(false);
    expect(await removeSubscription(db, owner.userId, browser.endpoint)).toBe(true);
  });
});
