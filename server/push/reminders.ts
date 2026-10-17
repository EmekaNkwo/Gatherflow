import { and, eq, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { composeReminder, reminderCounts, type ChurchReminder } from "@/services/reminders/digest";
import type { IsoDate, TeamMemberId } from "@/types/common";
import type { ChurchSnapshot } from "@/types/snapshot";
import { createSeedSnapshot } from "@/data/seed";
import type { Database } from "@/server/db/client";
import { churches, churchMembers, pushSubscriptions } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import type { BrowserSubscription } from "./subscriptions";

/**
 * The daily reminder run.
 *
 * Driven by a scheduler (see `/api/cron/reminders`), so a reminder reaches a
 * person whose GatherFlow tab is closed. Each subscription is *claimed* for
 * the day before anything is sent — one conditional update, so two runs
 * that overlap cannot both send it. A send that fails for a passing reason
 * releases the claim, so a later run tries again; a browser the push service
 * says is gone is forgotten.
 */
export type PushOutcome = { ok: true } | { ok: false; gone: boolean; error: string };
export type PushSender = (subscription: BrowserSubscription, payload: string) => Promise<PushOutcome>;

export interface ReminderRunOptions {
  today: IsoDate;
  send: PushSender;
  /** Limit the run to these accounts; every subscribed account otherwise. */
  userIds?: readonly string[];
}

export interface ReminderRunReport {
  considered: number;
  sent: number;
  nothingDue: number;
  removed: number;
  failed: number;
}

export async function sendDailyReminders(db: Database, options: ReminderRunOptions): Promise<ReminderRunReport> {
  const report: ReminderRunReport = { considered: 0, sent: 0, nothingDue: 0, removed: 0, failed: 0 };
  const due = await db
    .select()
    .from(pushSubscriptions)
    .where(and(notSentOn(options.today), options.userIds ? inArray(pushSubscriptions.userId, [...options.userIds]) : undefined));
  if (due.length === 0) return report;

  const messages = await messagesFor(db, [...new Set(due.map((row) => row.userId))], options.today);

  for (const row of due) {
    report.considered += 1;
    // Claim it for today; a concurrent run that got here first wins.
    const claimed = await db
      .update(pushSubscriptions)
      .set({ lastSentOn: options.today })
      .where(and(eq(pushSubscriptions.id, row.id), notSentOn(options.today)))
      .returning({ id: pushSubscriptions.id });
    if (claimed.length === 0) continue;

    const message = messages.get(row.userId);
    if (!message) {
      report.nothingDue += 1;
      continue;
    }

    const outcome = await options.send(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(message),
    );
    if (outcome.ok) {
      report.sent += 1;
    } else if (outcome.gone) {
      report.removed += 1;
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
    } else {
      report.failed += 1;
      await db.update(pushSubscriptions).set({ lastSentOn: row.lastSentOn }).where(eq(pushSubscriptions.id, row.id));
      console.error(
        JSON.stringify({ at: new Date().toISOString(), event: "push.reminder.failed", error: outcome.error }),
      );
    }
  }
  return report;
}

function notSentOn(today: IsoDate): SQL | undefined {
  return or(isNull(pushSubscriptions.lastSentOn), lt(pushSubscriptions.lastSentOn, today));
}

/** One message per account, adding up its work in every church it acts in. */
async function messagesFor(db: Database, userIds: string[], today: IsoDate) {
  const memberships = await db
    .select({
      userId: churchMembers.userId,
      churchId: churchMembers.churchId,
      churchName: churches.name,
      teamMemberId: churchMembers.teamMemberId,
    })
    .from(churchMembers)
    .innerJoin(churches, eq(churches.id, churchMembers.churchId))
    .where(and(inArray(churchMembers.userId, userIds), isNotNull(churchMembers.teamMemberId)));

  const snapshots = new Map<string, ChurchSnapshot>();
  for (const churchId of new Set(memberships.map((entry) => entry.churchId))) {
    const loaded = await createPostgresSnapshotRepository({
      db,
      churchId,
      createSeed: () => createSeedSnapshot(new Date()),
    }).load(FULL_SCOPE);
    snapshots.set(churchId, loaded.snapshot);
  }

  const byUser = new Map<string, ChurchReminder[]>();
  for (const entry of memberships) {
    const snapshot = snapshots.get(entry.churchId);
    if (!snapshot) continue;
    const counts = reminderCounts(snapshot, entry.teamMemberId as TeamMemberId, today);
    byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), { churchName: entry.churchName, ...counts }]);
  }

  return new Map(
    [...byUser].flatMap(([userId, reminders]) => {
      const message = composeReminder(reminders);
      return message ? [[userId, message] as const] : [];
    }),
  );
}
