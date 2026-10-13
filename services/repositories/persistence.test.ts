import { describe, expect, it } from "vitest";
import { createSeedSnapshot } from "@/data/seed";
import { member, snapshot, task, visitor } from "@/tests/factories";
import { storageKey } from "./collection";
import { createSnapshotRepository } from "./snapshot-repository";
import { createMemoryStorage } from "./storage";

const NOW = new Date("2026-10-12T09:00:00.000Z");
const seed = () => createSeedSnapshot(NOW);

describe("snapshot persistence", () => {
  it("writes the seed the first time and restores it afterwards", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);

    const first = repository.load();
    expect(first.seeded).toBe(true);

    const second = createSnapshotRepository(adapter, seed).load();
    expect(second.seeded).toBe(false);
    expect(second.snapshot.people.length).toBe(first.snapshot.people.length);
    expect(second.snapshot.settings.churchName).toBe(first.snapshot.settings.churchName);
  });

  it("round-trips a change made after loading", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const loaded = repository.load();

    const changed = {
      ...loaded.snapshot,
      tasks: [...loaded.snapshot.tasks, task({ id: "task_new", reference: "FU-9999" })],
    };
    repository.save(loaded.snapshot, changed);

    const reloaded = createSnapshotRepository(adapter, seed).load();
    expect(reloaded.snapshot.tasks.some((entry) => entry.reference === "FU-9999")).toBe(true);
  });

  it("only rewrites the collections that changed", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const loaded = repository.load();

    const attendanceBefore = adapter.getItem(storageKey("attendance"));
    repository.save(loaded.snapshot, { ...loaded.snapshot, tasks: [] });

    expect(adapter.getItem(storageKey("attendance"))).toBe(attendanceBefore);
    expect(adapter.getItem(storageKey("tasks"))).toContain('"data":[]');
  });

  it("drops invalid records instead of failing to start", () => {
    const adapter = createMemoryStorage();
    createSnapshotRepository(adapter, seed).load();

    const raw = JSON.parse(adapter.getItem(storageKey("people")) ?? "{}") as {
      version: number;
      data: unknown[];
    };
    adapter.setItem(
      storageKey("people"),
      JSON.stringify({
        ...raw,
        data: [...raw.data.slice(0, 3), { id: "broken" }, { nonsense: true }],
      }),
    );

    const loaded = createSnapshotRepository(adapter, seed).load();
    expect(loaded.seeded).toBe(false);
    expect(loaded.snapshot.people).toHaveLength(3);
    expect(loaded.report.dropped).toBe(2);
    expect(loaded.report.issues[0]).toContain("invalid people record");
  });

  it("falls back to the seed when the stored data is unusable", () => {
    const adapter = createMemoryStorage({
      [storageKey("people")]: "not json at all",
    });

    const loaded = createSnapshotRepository(adapter, seed).load();
    expect(loaded.seeded).toBe(true);
    expect(loaded.snapshot.people.length).toBeGreaterThan(0);
  });

  it("restores the default settings when the stored settings are invalid", () => {
    const adapter = createMemoryStorage();
    createSnapshotRepository(adapter, seed).load();
    adapter.setItem(
      storageKey("settings"),
      JSON.stringify({ version: 1, data: { churchName: "" } }),
    );

    const loaded = createSnapshotRepository(adapter, seed).load();
    expect(loaded.seeded).toBe(true);
    expect(loaded.snapshot.settings.churchName).toBe("Grace Community Church");
  });

  it("reset clears stored data and writes a fresh seed", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const loaded = repository.load();
    repository.save(loaded.snapshot, { ...loaded.snapshot, tasks: [] });

    const fresh = repository.reset();
    expect(fresh.tasks.length).toBeGreaterThan(0);
    expect(createSnapshotRepository(adapter, seed).load().snapshot.tasks.length).toBe(
      fresh.tasks.length,
    );
  });
});

describe("export and import", () => {
  it("excludes pastoral-care records and emergency contacts from the export", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const loaded = repository.load();

    const bundle = repository.exportBundle(loaded.snapshot);
    const exported = bundle.data as Record<string, unknown>;

    expect("careRecords" in exported).toBe(false);
    expect(loaded.snapshot.careRecords.length).toBeGreaterThan(0);
    const people = exported.people as Array<{ member?: { emergencyContact?: unknown } }>;
    expect(people.every((person) => !person.member?.emergencyContact)).toBe(true);
    expect(bundle.note).toContain("Pastoral-care records");
  });

  it("imports a bundle and never carries restricted records", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const current = repository.load().snapshot;

    const bundle = {
      application: "gatherflow",
      schemaVersion: 1,
      exportedAt: NOW.toISOString(),
      note: "",
      data: {
        ...snapshot({ people: [visitor(), member()] }),
        careRecords: undefined,
      },
    };

    const imported = repository.importBundle(bundle, current);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.value.people).toHaveLength(2);
      expect(imported.value.careRecords).toHaveLength(0);
      // Templates and team fall back to what is already loaded.
      expect(imported.value.team.length).toBeGreaterThan(0);
    }
  });

  it("rejects a file that is not a GatherFlow export", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const current = repository.load().snapshot;

    expect(repository.importBundle({ hello: "world" }, current).ok).toBe(false);
    expect(
      repository.importBundle(
        { application: "gatherflow", schemaVersion: 99, data: {} },
        current,
      ).ok,
    ).toBe(false);
  });

  it("rejects an export with no usable people", () => {
    const adapter = createMemoryStorage();
    const repository = createSnapshotRepository(adapter, seed);
    const current = repository.load().snapshot;

    const outcome = repository.importBundle(
      { application: "gatherflow", schemaVersion: 1, data: { people: [{ id: "x" }] } },
      current,
    );

    expect(outcome.ok).toBe(false);
  });
});
