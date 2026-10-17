// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { createCareRecord } from "@/services/care/care";
import { createCommandContext } from "@/services/core/context";
import { createDatabase, type Database } from "@/server/db/client";
import { churches } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { BACKUP_KIND, backupChurch, parseBackup, restoreChurch } from "./backup";

const CONNECTION = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-12T09:00:00.000Z");
const seed = () => createSeedSnapshot(NOW);

let db: Database;
const created: string[] = [];

function repo(churchId: string) {
  return createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
}

async function church(suffix: string) {
  const churchId = `backup-church-${process.pid}-${suffix}`;
  created.push(churchId);
  const loaded = await repo(churchId).load(FULL_SCOPE);
  return { churchId, loaded };
}

describe.skipIf(!CONNECTION)("backup and restore", { timeout: 60_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });
  afterAll(async () => {
    for (const id of created) await db.delete(churches).where(eq(churches.id, id));
  });

  it("captures everything, including what the demo export leaves out, and puts it back", async () => {
    const { churchId, loaded } = await church("roundtrip");

    // Something the portable export would drop.
    const person = loaded.snapshot.people[0];
    const withCare = createCareRecord(
      loaded.snapshot,
      { personId: person.id, category: "prayer_request", summary: "Private", receivedAt: "2026-10-12", note: "restricted" },
      createCommandContext({ actorId: loaded.snapshot.team[0].id, now: NOW }),
    );
    if (!withCare.ok) throw new Error(withCare.error);
    await repo(churchId).save(loaded.snapshot, withCare.value.snapshot, loaded.version);

    const backup = await backupChurch(db, churchId);
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    expect(backup.value.kind).toBe(BACKUP_KIND);
    expect(backup.value.data.careRecords.some((entry) => entry.summary === "Private")).toBe(true);
    expect(backup.value.data.people).toHaveLength(loaded.snapshot.people.length);

    // Damage: rename the church and delete every task.
    const damaged = await repo(churchId).load(FULL_SCOPE);
    await repo(churchId).save(
      damaged.snapshot,
      { ...damaged.snapshot, tasks: [], settings: { ...damaged.snapshot.settings, churchName: "Broken" } },
      damaged.version,
    );
    expect((await repo(churchId).load(FULL_SCOPE)).snapshot.tasks).toHaveLength(0);

    // The file as it would come back from disk.
    const restored = await restoreChurch(db, churchId, JSON.parse(JSON.stringify(backup.value)));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.counts.tasks).toBe(backup.value.data.tasks.length);

    const after = await repo(churchId).load(FULL_SCOPE);
    expect(after.snapshot.settings.churchName).toBe(backup.value.data.settings.churchName);
    expect(after.snapshot.tasks).toEqual(backup.value.data.tasks);
    expect(after.snapshot.careRecords).toEqual(backup.value.data.careRecords);
    expect(after.snapshot.people).toEqual(backup.value.data.people);
    // The version moved on: the restore is a commit like any other.
    expect(after.version).toBeGreaterThan(backup.value.version);
  });

  it("refuses a backup of another church unless told otherwise", async () => {
    const [source, target] = await Promise.all([church("src"), church("dst")]);
    const backup = await backupChurch(db, source.churchId);
    if (!backup.ok) throw new Error(backup.error);

    const refused = await restoreChurch(db, target.churchId, backup.value);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("allowDifferentChurch");

    const allowed = await restoreChurch(db, target.churchId, backup.value, { allowDifferentChurch: true });
    expect(allowed.ok).toBe(true);
  });

  it("refuses a file that is not whole rather than dropping records", async () => {
    const { churchId } = await church("strict");
    const backup = await backupChurch(db, churchId);
    if (!backup.ok) throw new Error(backup.error);

    const corrupted = JSON.parse(JSON.stringify(backup.value)) as typeof backup.value;
    (corrupted.data.people as unknown[])[0] = { id: "broken" };
    const outcome = restoreChurch(db, churchId, corrupted);
    expect((await outcome).ok).toBe(false);

    expect(parseBackup({ kind: "something-else" }).ok).toBe(false);
    expect(parseBackup({ ...backup.value, schemaVersion: 99 }).ok).toBe(false);
    expect(parseBackup(backup.value).ok).toBe(true);
  });

  it("knows a church that does not exist, and never creates one by looking", async () => {
    const outcome = await backupChurch(db, "backup-no-such-church");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
    const [row] = await db.select({ id: churches.id }).from(churches).where(eq(churches.id, "backup-no-such-church"));
    expect(row).toBeUndefined();
  });

  it("backs up an empty church as an empty church, writing nothing", async () => {
    const { churchId, loaded } = await church("empty");
    await repo(churchId).save(loaded.snapshot, { ...loaded.snapshot, people: [] }, loaded.version);

    const outcome = await backupChurch(db, churchId);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.data.people).toEqual([]);

    // Still empty: looking did not seed.
    const { people } = await import("@/server/db/schema");
    const rows = await db.select({ id: people.id }).from(people).where(eq(people.churchId, churchId));
    expect(rows).toHaveLength(0);
  });
});
