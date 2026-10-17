import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { pushSubscriptions } from "@/server/db/schema";

/**
 * What a browser hands over when it agrees to receive pushes: where to send
 * them, and the keys to encrypt them with. Stored per account.
 */
export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/**
 * Saves a browser's subscription. The same browser subscribing again — or
 * another account signing in on it and subscribing — replaces the row, so a
 * shared computer only ever reminds whoever turned reminders on last.
 */
export async function saveSubscription(db: Database, userId: string, subscription: BrowserSubscription): Promise<void> {
  const values = {
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };
  await db
    .insert(pushSubscriptions)
    .values({ id: subscriptionId(subscription.endpoint), ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.id, set: values });
}

/** Removes a browser's subscription; only the account that owns it can. */
export async function removeSubscription(db: Database, userId: string, endpoint: string): Promise<boolean> {
  const removed = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, subscriptionId(endpoint)), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return removed.length > 0;
}

export async function hasSubscription(db: Database, userId: string, endpoint: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, subscriptionId(endpoint)), eq(pushSubscriptions.userId, userId)));
  return Boolean(row);
}
