import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import type { ChurchSnapshot } from "@/types/snapshot";
import { SCHEMA_VERSION, type LoadReport } from "./collection";
import { churchSettingsSchema, collectionSchemas } from "./schema";

/**
 * Demo export and import.
 *
 * These are pure functions over a snapshot, with no storage of their own, so
 * the browser and the server share one definition of what leaves the system
 * and what is accepted back.
 */

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

/**
 * Builds the portable bundle.
 *
 * Pastoral-care records and emergency contacts are deliberately left out:
 * restricted information does not belong in a portable export.
 */
export function buildExportBundle(snapshot: ChurchSnapshot, exportedAt: string): ExportBundle {
  return {
    application: "gatherflow",
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
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
}

/**
 * Validates an uploaded bundle into a snapshot.
 *
 * Invalid records are dropped rather than failing the whole import; a bundle
 * with no usable people is refused, because there would be nothing to show.
 */
export function parseImportBundle(
  raw: unknown,
  current: ChurchSnapshot,
): Result<ChurchSnapshot> {
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
    return value.flatMap((candidate) => {
      const result = schema.safeParse(candidate);
      if (!result.success) {
        report.dropped += 1;
        return [];
      }
      return [result.data];
    });
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
}
