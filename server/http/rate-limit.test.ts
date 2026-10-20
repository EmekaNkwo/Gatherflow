// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { createDatabase, type Database } from "@/server/db/client";
import { requestBudgets } from "@/server/db/schema";
import { consumeBudget, pruneBudgets } from "./rate-limit";

/**
 * The shared request budget: one counter per key in Postgres, so every
 * instance of the application spends from the same allowance.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const PREFIX = `test-${process.pid}-`;
let db: Database;
let other: Database;

describe.skipIf(!CONNECTION)("request budget", { timeout: 60_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 8 });
    // A second pool stands in for a second instance of the application.
    other = createDatabase({ connectionString: CONNECTION as string, max: 8 });
  });
  afterAll(async () => {
    await db.delete(requestBudgets).where(like(requestBudgets.key, `${PREFIX}%`));
  });

  it("allows up to the budget, then refuses with a retry time", async () => {
    const key = `${PREFIX}basic`;
    const rule = { window: 60, max: 3 };
    for (let i = 0; i < 3; i += 1) {
      expect((await consumeBudget(db, key, rule)).allowed).toBe(true);
    }
    const refused = await consumeBudget(db, key, rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(60);
  });

  it("is one budget across instances, even under concurrent requests", async () => {
    const key = `${PREFIX}shared`;
    const rule = { window: 60, max: 5 };
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, i) => consumeBudget(i % 2 ? db : other, key, rule)),
    );
    expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(5);
  });

  it("keeps keys apart", async () => {
    const rule = { window: 60, max: 1 };
    expect((await consumeBudget(db, `${PREFIX}a`, rule)).allowed).toBe(true);
    expect((await consumeBudget(db, `${PREFIX}b`, rule)).allowed).toBe(true);
    expect((await consumeBudget(db, `${PREFIX}a`, rule)).allowed).toBe(false);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const key = `${PREFIX}window`;
    const rule = { window: 1, max: 1 };
    expect((await consumeBudget(db, key, rule)).allowed).toBe(true);
    expect((await consumeBudget(db, key, rule)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await consumeBudget(db, key, rule)).allowed).toBe(true);
  });

  it("prunes windows that ended long ago", async () => {
    const key = `${PREFIX}stale`;
    await consumeBudget(db, key, { window: 1, max: 1 });
    expect(await pruneBudgets(db, 0)).toBeGreaterThanOrEqual(1);
  });
});
