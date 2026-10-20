// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { err, ok } from "@/lib/result";
import { createSeedSnapshot } from "@/data/seed";
import { createDatabase, type Database } from "@/server/db/client";
import { auditLog, churches } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { auditResult, recentAudit, recordAudit, targetOf } from "./audit";

const CONNECTION = process.env.TEST_DATABASE_URL;
let db: Database;
const created: string[] = [];

async function church(suffix: string) {
  const churchId = `audit-church-${process.pid}-${suffix}`;
  created.push(churchId);
  await createPostgresSnapshotRepository({
    db,
    churchId,
    createSeed: () => createSeedSnapshot(new Date()),
  }).load();
  return churchId;
}

describe.skipIf(!CONNECTION)("audit trail", { timeout: 60_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });
  afterAll(async () => {
    for (const id of created) await db.delete(churches).where(eq(churches.id, id));
  });

  it("records outcomes and refusals, newest first, and only for the church asked", async () => {
    const [mine, theirs] = await Promise.all([church("mine"), church("theirs")]);

    await auditResult(
      db,
      { churchId: mine, userId: "user-1", actorId: "tm_1", action: "task.complete", targetId: "task_9" },
      ok(undefined),
    );
    await auditResult(
      db,
      { churchId: mine, userId: "user-2", actorId: null, action: "settings.update" },
      err("not allowed", "forbidden"),
    );
    await recordAudit(db, { churchId: theirs, userId: "user-3", action: "x", outcome: "ok" });

    const entries = await recentAudit(db, mine);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      userId: "user-2",
      action: "settings.update",
      outcome: "refused",
      code: "forbidden",
      targetId: null,
    });
    expect(entries[1]).toMatchObject({
      userId: "user-1",
      actorId: "tm_1",
      action: "task.complete",
      targetId: "task_9",
      outcome: "ok",
      code: null,
    });
    expect(new Date(entries[0].at).getTime()).toBeGreaterThanOrEqual(new Date(entries[1].at).getTime());
  });

  it("caps the window and the count", async () => {
    const churchId = await church("window");
    for (let index = 0; index < 5; index += 1) {
      await recordAudit(db, { churchId, userId: "u", action: `a${index}`, outcome: "ok" });
    }
    // One entry pushed out of the window.
    const [oldest] = await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.churchId, churchId)).limit(1);
    await db
      .update(auditLog)
      .set({ at: new Date(Date.now() - 100 * 24 * 60 * 60_000) })
      .where(eq(auditLog.id, oldest.id));

    expect(await recentAudit(db, churchId)).toHaveLength(4);
    expect(await recentAudit(db, churchId, { limit: 2 })).toHaveLength(2);
    expect(await recentAudit(db, churchId, { sinceDays: 365 })).toHaveLength(5);
  });

  it("does not throw when the write fails", async () => {
    // A church that does not exist violates the foreign key.
    await expect(
      recordAudit(db, { churchId: "no-such-church", userId: "u", action: "a", outcome: "ok" }),
    ).resolves.toBeUndefined();
  });
});

describe("what an audit entry keeps", () => {
  it("takes an id from a command's input and nothing else", () => {
    expect(targetOf({ personId: "p1", body: "a private note" })).toBe("p1");
    expect(targetOf({ taskId: "t1", outcome: "contacted" })).toBe("t1");
    expect(targetOf({ recordId: "c1", text: "restricted" })).toBe("c1");
    expect(targetOf({ name: "Welcome", body: "..." })).toBeNull();
    expect(targetOf("string")).toBeNull();
    expect(targetOf(null)).toBeNull();
    expect(targetOf({ personId: 42 })).toBeNull();
    // Rule and team-member edits name their subject `id` (M10).
    expect(targetOf({ id: "first_visit_welcome", changes: { enabled: false } })).toBe("first_visit_welcome");
    expect(targetOf({ id: "tm_vol_tunde", name: "Tunde", role: "volunteer" })).toBe("tm_vol_tunde");
    expect(targetOf({ fromTeamMemberId: "tm_a", toTeamMemberId: "tm_b" })).toBe("tm_a");
  });
});
