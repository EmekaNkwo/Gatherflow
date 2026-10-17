import { lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { requestBudgets } from "@/server/db/schema";

/**
 * A request budget shared by every instance of the application.
 *
 * One statement both records the request and reads the total, so concurrent
 * requests cannot all pass a stale count: the upsert takes the row lock, and
 * each request sees the count including itself. When the key's window has
 * passed, the same statement starts a new one at this request.
 *
 * Shaped like Better Auth's `customStorage.consume`, which uses it for the
 * credential endpoints; the public welcome page uses it directly.
 */
export interface BudgetRule {
  /** Seconds. */
  window: number;
  max: number;
}

export interface BudgetOutcome {
  allowed: boolean;
  /** Seconds until the window frees up, when refused. */
  retryAfter: number | null;
}

export async function consumeBudget(db: Database, key: string, rule: BudgetRule): Promise<BudgetOutcome> {
  const expired = sql`${requestBudgets.windowStart} <= now() - make_interval(secs => ${rule.window})`;
  const [row] = await db
    .insert(requestBudgets)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: requestBudgets.key,
      set: {
        windowStart: sql`case when ${expired} then now() else ${requestBudgets.windowStart} end`,
        count: sql`case when ${expired} then 1 else ${requestBudgets.count} + 1 end`,
      },
    })
    .returning({
      count: requestBudgets.count,
      remaining: sql<number>`greatest(0, ceil(extract(epoch from (${requestBudgets.windowStart} + make_interval(secs => ${rule.window}) - now()))))::int`,
    });

  if (row.count <= rule.max) return { allowed: true, retryAfter: null };
  return { allowed: false, retryAfter: Math.max(1, Number(row.remaining)) };
}

/** Drops budgets whose window started more than `olderThanSeconds` ago. */
export async function pruneBudgets(db: Database, olderThanSeconds = 24 * 60 * 60): Promise<number> {
  const removed = await db
    .delete(requestBudgets)
    .where(lt(requestBudgets.windowStart, sql`now() - make_interval(secs => ${olderThanSeconds})`))
    .returning({ key: requestBudgets.key });
  return removed.length;
}
