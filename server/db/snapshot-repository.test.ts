// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { CONFLICT } from "@/services/repositories/async-snapshot-repository";
import type { ChurchSnapshot } from "@/types/snapshot";
import { createDatabase, type Database } from "./client";
import { attendance, churches, people, tasks } from "./schema";
import { createPostgresSnapshotRepository } from "./snapshot-repository";

/**
 * Integration tests against a real Postgres.
 *
 * These run only when TEST_DATABASE_URL is set, so `npm test` stays green on a
 * machine with no database. See README → Database.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-12T09:00:00.000Z");
const seed = () => createSeedSnapshot(NOW);

let db: Database;
let counter = 0;
const created: string[] = [];

/** A fresh church id per test, so tests cannot interfere with one another. */
function nextChurchId(): string {
  counter += 1;
  const id = `test-church-${process.pid}-${counter}`;
  created.push(id);
  return id;
}

function repositoryFor(churchId: string) {
  return createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
}

describe.skipIf(!CONNECTION)("postgres snapshot repository", () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });

  afterAll(async () => {
    for (const id of created) {
      await db.delete(churches).where(eq(churches.id, id));
    }
  });

  it("writes the seed the first time and restores it afterwards", async () => {
    const churchId = nextChurchId();

    const first = await repositoryFor(churchId).load();
    expect(first.seeded).toBe(true);
    expect(first.version).toBe(1);
    expect(first.report.dropped).toBe(0);

    const second = await repositoryFor(churchId).load();
    expect(second.seeded).toBe(false);
    expect(second.snapshot.people.length).toBe(first.snapshot.people.length);
    expect(second.snapshot.attendance.length).toBe(first.snapshot.attendance.length);
    expect(second.snapshot.settings.churchName).toBe(first.snapshot.settings.churchName);
  });

  it("accepts the full seed under the database's own uniqueness constraints", async () => {
    // The application enforces one attendance row per person per session and
    // one task per automationKey in memory. If those are real invariants the
    // database can hold them; this proves the real seed satisfies both.
    const churchId = nextChurchId();
    const loaded = await repositoryFor(churchId).load();

    const keys = loaded.snapshot.tasks
      .map((task) => task.automationKey)
      .filter((key): key is string => Boolean(key));
    expect(new Set(keys).size).toBe(keys.length);

    const pairs = loaded.snapshot.attendance.map((row) => `${row.sessionId}:${row.personId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("refuses a duplicate automationKey at the database level", async () => {
    const churchId = nextChurchId();
    const loaded = await repositoryFor(churchId).load();
    const automated = loaded.snapshot.tasks.find((task) => task.automationKey);
    expect(automated).toBeDefined();

    await expect(
      db.insert(tasks).values({
        churchId,
        id: "task-duplicate-probe",
        personId: automated!.personId,
        assigneeId: null,
        status: automated!.status,
        dueDate: automated!.dueDate,
        automationKey: automated!.automationKey!,
        data: { ...automated!, id: "task-duplicate-probe" },
      }),
    ).rejects.toThrow();
  });

  it("refuses two attendance rows for the same person and session", async () => {
    const churchId = nextChurchId();
    const loaded = await repositoryFor(churchId).load();
    const row = loaded.snapshot.attendance[0];
    expect(row).toBeDefined();

    await expect(
      db.insert(attendance).values({
        churchId,
        id: "attendance-duplicate-probe",
        sessionId: row.sessionId,
        personId: row.personId,
        status: row.status,
        data: { ...row, id: "attendance-duplicate-probe" },
      }),
    ).rejects.toThrow();
  });

  it("round-trips a change made after loading", async () => {
    const churchId = nextChurchId();
    const repository = repositoryFor(churchId);
    const loaded = await repository.load();

    const target = loaded.snapshot.people[0];
    const renamed: ChurchSnapshot = {
      ...loaded.snapshot,
      settings: { ...loaded.snapshot.settings, churchName: "Second Church" },
      people: loaded.snapshot.people.map((person) =>
        person.id === target.id ? { ...person, firstName: "Renamed" } : person,
      ),
    };

    const saved = await repository.save(loaded.snapshot, renamed, loaded.version);
    expect(saved.ok).toBe(true);

    const reloaded = await repositoryFor(churchId).load();
    expect(reloaded.snapshot.settings.churchName).toBe("Second Church");
    expect(reloaded.snapshot.people.find((p) => p.id === target.id)?.firstName).toBe("Renamed");
    expect(reloaded.snapshot.people.length).toBe(loaded.snapshot.people.length);
    expect(reloaded.version).toBe(loaded.version + 1);
  });

  it("returns collections in a stable order across loads", async () => {
    // Postgres gives no ordering guarantee without ORDER BY, so without one a
    // reload would reshuffle every list in the interface.
    const churchId = nextChurchId();
    await repositoryFor(churchId).load();

    const first = await repositoryFor(churchId).load();
    const second = await repositoryFor(churchId).load();

    expect(second.snapshot.people.map((p) => p.id)).toEqual(
      first.snapshot.people.map((p) => p.id),
    );
    expect(second.snapshot.attendance.map((a) => a.id)).toEqual(
      first.snapshot.attendance.map((a) => a.id),
    );
  });

  it("drops invalid stored records instead of failing the load", async () => {
    const churchId = nextChurchId();
    await repositoryFor(churchId).load();

    // A row whose jsonb no longer satisfies the schema: firstName is required.
    await db.insert(people).values({
      churchId,
      id: "person-corrupt",
      kind: "visitor",
      email: null,
      phone: null,
      householdId: null,
      optedOut: false,
      permissionGranted: false,
      data: { id: "person-corrupt", kind: "visitor" } as never,
    });

    const reloaded = await repositoryFor(churchId).load();
    expect(reloaded.seeded).toBe(false);
    expect(reloaded.report.dropped).toBe(1);
    expect(reloaded.report.issues.join(" ")).toContain("people");
    expect(reloaded.snapshot.people.some((p) => p.id === "person-corrupt")).toBe(false);
  });

  it("writes only the collections whose reference changed", async () => {
    const churchId = nextChurchId();
    const repository = repositoryFor(churchId);
    const loaded = await repository.load();

    // A row the snapshot does not know about. If `save` rewrote attendance it
    // would be deleted; surviving proves that collection was left alone.
    await db.insert(attendance).values({
      churchId,
      id: "attendance-sentinel",
      sessionId: "session-sentinel",
      personId: "person-sentinel",
      status: "present",
      data: { ...loaded.snapshot.attendance[0], id: "attendance-sentinel" },
    });

    const peopleOnly: ChurchSnapshot = {
      ...loaded.snapshot,
      people: loaded.snapshot.people.map((person, index) =>
        index === 0 ? { ...person, lastName: "Changed" } : person,
      ),
    };

    const saved = await repository.save(loaded.snapshot, peopleOnly, loaded.version);
    expect(saved.ok).toBe(true);

    const survivors = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendance)
      .where(eq(attendance.id, "attendance-sentinel"));
    expect(survivors[0]?.count).toBe(1);
  });

  it("refuses a commit whose version guard is stale", async () => {
    const churchId = nextChurchId();
    const repository = repositoryFor(churchId);
    const loaded = await repository.load();

    const first: ChurchSnapshot = {
      ...loaded.snapshot,
      settings: { ...loaded.snapshot.settings, churchName: "First Writer" },
    };
    const second: ChurchSnapshot = {
      ...loaded.snapshot,
      settings: { ...loaded.snapshot.settings, churchName: "Second Writer" },
    };

    const a = await repository.save(loaded.snapshot, first, loaded.version);
    expect(a.ok).toBe(true);

    // Same guard, already spent.
    const b = await repository.save(loaded.snapshot, second, loaded.version);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe(CONFLICT);

    // The first writer's change stands; the second did not partially apply.
    const reloaded = await repositoryFor(churchId).load();
    expect(reloaded.snapshot.settings.churchName).toBe("First Writer");
  });

  it("keeps churches isolated from one another", async () => {
    const a = nextChurchId();
    const b = nextChurchId();

    const loadedA = await repositoryFor(a).load();
    await repositoryFor(b).load();

    const renamed: ChurchSnapshot = {
      ...loadedA.snapshot,
      settings: { ...loadedA.snapshot.settings, churchName: "Church A" },
    };
    await repositoryFor(a).save(loadedA.snapshot, renamed, loadedA.version);

    const reloadedB = await repositoryFor(b).load();
    expect(reloadedB.snapshot.settings.churchName).not.toBe("Church A");
  });

  it("restores the original church on reset", async () => {
    const churchId = nextChurchId();
    const repository = repositoryFor(churchId);
    const loaded = await repository.load();

    const emptied: ChurchSnapshot = { ...loaded.snapshot, tasks: [] };
    await repository.save(loaded.snapshot, emptied, loaded.version);
    expect((await repositoryFor(churchId).load()).snapshot.tasks.length).toBe(0);

    const restored = await repository.reset();
    expect(restored.seeded).toBe(true);
    expect(restored.snapshot.tasks.length).toBe(loaded.snapshot.tasks.length);
    expect(restored.version).toBe(1);
  });

  it("leaves pastoral care and emergency contacts out of an export", async () => {
    const churchId = nextChurchId();
    const repository = repositoryFor(churchId);
    const loaded = await repository.load();
    expect(loaded.snapshot.careRecords.length).toBeGreaterThan(0);

    const bundle = repository.exportBundle(loaded.snapshot);
    expect("careRecords" in bundle.data).toBe(false);
    expect(
      bundle.data.people.some((person) => person.member?.emergencyContact !== undefined),
    ).toBe(false);
  });

  it("never carries pastoral care back in through an import", async () => {
    const churchId = nextChurchId();
    const repository = repositoryFor(churchId);
    const loaded = await repository.load();

    const bundle = repository.exportBundle(loaded.snapshot);
    const imported = repository.importBundle(bundle, loaded.snapshot);

    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.value.careRecords).toEqual([]);
  });
});
