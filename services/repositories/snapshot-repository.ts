import { z } from "zod";
import type { ChurchSnapshot } from "@/types/snapshot";
import { err, ok, type Result } from "@/lib/result";
import {
  createCollectionRepository,
  createDocumentRepository,
  SCHEMA_VERSION,
  STORAGE_NAMESPACE,
  storageKey,
  type LoadReport,
} from "./collection";
import { churchSettingsSchema, collectionSchemas } from "./schema";
import type { StorageAdapter } from "./storage";

export interface SnapshotLoadResult {
  snapshot: ChurchSnapshot;
  /** `true` when seed data was written because nothing valid was stored. */
  seeded: boolean;
  report: LoadReport;
}

/**
 * The persistence boundary for the whole application.
 *
 * `save` only writes the collections whose array reference changed, which
 * keeps commands cheap: a visitor registration rewrites people, tasks and
 * activity, not attendance history.
 */
export interface SnapshotRepository {
  load(): SnapshotLoadResult;
  save(previous: ChurchSnapshot | null, next: ChurchSnapshot): void;
  /** Wipes stored data and writes a fresh seed. */
  reset(): ChurchSnapshot;
  /** Non-sensitive bundle for the demo export. */
  exportBundle(snapshot: ChurchSnapshot): ExportBundle;
  importBundle(raw: unknown, current: ChurchSnapshot): Result<ChurchSnapshot>;
}

export interface ExportBundle {
  application: "gatherflow";
  schemaVersion: number;
  exportedAt: string;
  note: string;
  data: Omit<ChurchSnapshot, "careRecords">;
}

const exportBundleSchema = z.object({
  application: z.literal("gatherflow"),
  schemaVersion: z.number(),
  data: z.record(z.string(), z.unknown()),
});

export function createSnapshotRepository(
  adapter: StorageAdapter,
  createSeed: () => ChurchSnapshot,
): SnapshotRepository {
  const repositories = {
    people: createCollectionRepository(adapter, "people", collectionSchemas.people),
    households: createCollectionRepository(adapter, "households", collectionSchemas.households),
    groups: createCollectionRepository(adapter, "groups", collectionSchemas.groups),
    tasks: createCollectionRepository(adapter, "tasks", collectionSchemas.tasks),
    sessions: createCollectionRepository(adapter, "sessions", collectionSchemas.sessions),
    attendance: createCollectionRepository(adapter, "attendance", collectionSchemas.attendance),
    careRecords: createCollectionRepository(adapter, "careRecords", collectionSchemas.careRecords),
    templates: createCollectionRepository(adapter, "templates", collectionSchemas.templates),
    communications: createCollectionRepository(
      adapter,
      "communications",
      collectionSchemas.communications,
    ),
    team: createCollectionRepository(adapter, "team", collectionSchemas.team),
    activity: createCollectionRepository(adapter, "activity", collectionSchemas.activity),
  } as const;

  const settingsRepository = createDocumentRepository(adapter, "settings", churchSettingsSchema);

  function writeAll(snapshot: ChurchSnapshot): void {
    repositories.people.saveAll(snapshot.people);
    repositories.households.saveAll(snapshot.households);
    repositories.groups.saveAll(snapshot.groups);
    repositories.tasks.saveAll(snapshot.tasks);
    repositories.sessions.saveAll(snapshot.sessions);
    repositories.attendance.saveAll(snapshot.attendance);
    repositories.careRecords.saveAll(snapshot.careRecords);
    repositories.templates.saveAll(snapshot.templates);
    repositories.communications.saveAll(snapshot.communications);
    repositories.team.saveAll(snapshot.team);
    repositories.activity.saveAll(snapshot.activity);
    settingsRepository.save(snapshot.settings);
    adapter.setItem(
      `${STORAGE_NAMESPACE}:meta`,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString() }),
    );
  }

  function load(): SnapshotLoadResult {
    const report: LoadReport = { dropped: 0, issues: [] };
    const seed = createSeed();

    const people = repositories.people.load(report);
    const settings = settingsRepository.load(report);

    // People and settings are the backbone: without them there is nothing
    // meaningful to restore, so the seed is written instead of a half state.
    if (people === null || people.length === 0 || settings === null) {
      writeAll(seed);
      return { snapshot: seed, seeded: true, report };
    }

    const snapshot: ChurchSnapshot = {
      people,
      settings,
      households: repositories.households.load(report) ?? [],
      groups: repositories.groups.load(report) ?? [],
      tasks: repositories.tasks.load(report) ?? [],
      sessions: repositories.sessions.load(report) ?? [],
      attendance: repositories.attendance.load(report) ?? [],
      careRecords: repositories.careRecords.load(report) ?? [],
      templates: repositories.templates.load(report) ?? seed.templates,
      communications: repositories.communications.load(report) ?? [],
      team: repositories.team.load(report) ?? seed.team,
      activity: repositories.activity.load(report) ?? [],
    };

    return { snapshot, seeded: false, report };
  }

  return {
    load,
    save(previous, next) {
      if (!previous) {
        writeAll(next);
        return;
      }
      if (previous.people !== next.people) repositories.people.saveAll(next.people);
      if (previous.households !== next.households)
        repositories.households.saveAll(next.households);
      if (previous.groups !== next.groups) repositories.groups.saveAll(next.groups);
      if (previous.tasks !== next.tasks) repositories.tasks.saveAll(next.tasks);
      if (previous.sessions !== next.sessions) repositories.sessions.saveAll(next.sessions);
      if (previous.attendance !== next.attendance)
        repositories.attendance.saveAll(next.attendance);
      if (previous.careRecords !== next.careRecords)
        repositories.careRecords.saveAll(next.careRecords);
      if (previous.templates !== next.templates) repositories.templates.saveAll(next.templates);
      if (previous.communications !== next.communications)
        repositories.communications.saveAll(next.communications);
      if (previous.team !== next.team) repositories.team.saveAll(next.team);
      if (previous.activity !== next.activity) repositories.activity.saveAll(next.activity);
      if (previous.settings !== next.settings) settingsRepository.save(next.settings);
    },
    reset() {
      for (const key of adapter.keys()) {
        if (key.startsWith(`${STORAGE_NAMESPACE}:`)) {
          adapter.removeItem(key);
        }
      }
      const seed = createSeed();
      writeAll(seed);
      return seed;
    },
    exportBundle(snapshot) {
      // Pastoral-care records and emergency contacts are deliberately left
      // out: restricted information does not belong in a portable export.
      return {
        application: "gatherflow",
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        note: "Synthetic demo data. Pastoral-care records and emergency contacts are excluded.",
        data: {
          households: snapshot.households,
          groups: snapshot.groups,
          tasks: snapshot.tasks,
          sessions: snapshot.sessions,
          attendance: snapshot.attendance,
          templates: snapshot.templates,
          communications: snapshot.communications,
          team: snapshot.team,
          activity: snapshot.activity,
          settings: snapshot.settings,
          people: snapshot.people.map((person) =>
            person.member?.emergencyContact
              ? {
                  ...person,
                  member: { ...person.member, emergencyContact: undefined },
                }
              : person,
          ),
        },
      };
    },
    importBundle(raw, current) {
      const envelope = exportBundleSchema.safeParse(raw);
      if (!envelope.success) {
        return err("That file is not a GatherFlow export.");
      }
      if (envelope.data.schemaVersion !== SCHEMA_VERSION) {
        return err(
          `That export uses schema version ${envelope.data.schemaVersion}; this build reads version ${SCHEMA_VERSION}.`,
        );
      }

      const report: LoadReport = { dropped: 0, issues: [] };
      const data = envelope.data.data as Record<string, unknown>;

      function parseList<T extends { id: string }>(
        name: keyof typeof collectionSchemas,
        fallback: readonly T[],
      ): readonly T[] {
        const value = data[name];
        if (!Array.isArray(value)) return fallback;
        const schema = collectionSchemas[name] as unknown as z.ZodType<T>;
        const parsed = value.flatMap((candidate) => {
          const result = schema.safeParse(candidate);
          if (!result.success) {
            report.dropped += 1;
            return [];
          }
          return [result.data];
        });
        return parsed;
      }

      const settings = churchSettingsSchema.safeParse(data.settings);
      const people = parseList("people", []);
      if (!people.length) {
        return err("That export contains no valid people records.");
      }

      return ok({
        people,
        households: parseList("households", []),
        groups: parseList("groups", []),
        tasks: parseList("tasks", []),
        sessions: parseList("sessions", []),
        attendance: parseList("attendance", []),
        // Restricted records are never carried by an import.
        careRecords: [],
        templates: parseList("templates", current.templates),
        communications: parseList("communications", []),
        team: parseList("team", current.team),
        activity: parseList("activity", []),
        settings: settings.success ? settings.data : current.settings,
      });
    },
  };
}

export { storageKey };
