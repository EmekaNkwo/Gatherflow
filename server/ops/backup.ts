import { z } from "zod";
import { createSeedSnapshot } from "@/data/seed";
import { err, ok, type Result } from "@/lib/result";
import { CONFLICT, FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { SCHEMA_VERSION } from "@/services/repositories/collection";
import { churchSettingsSchema, collectionSchemas } from "@/services/repositories/schema";
import type { ChurchSnapshot } from "@/types/snapshot";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { churches } from "@/server/db/schema";
import {
  ChurchNotReadyError,
  createPostgresSnapshotRepository,
} from "@/server/db/snapshot-repository";

/**
 * Backup and restore of one church, whole.
 *
 * This is not the demo export. That one is a portable file a person
 * downloads, and it deliberately leaves pastoral care and emergency contacts
 * out. A backup is an operator's copy of everything, taken so it can be put
 * back exactly; leaving anything out would make the restore a loss. It is
 * therefore behind the operator secret, never a role, and is meant to live
 * somewhere encrypted at rest.
 *
 * A restore is strict where the export is lenient: a backup is expected to
 * be whole, so one invalid record refuses the whole file rather than quietly
 * dropping it.
 */

export const BACKUP_KIND = "gatherflow-church-backup";

export interface ChurchBackup {
  kind: typeof BACKUP_KIND;
  schemaVersion: number;
  churchId: string;
  /** The church's version at the moment of the backup. */
  version: number;
  takenAt: string;
  data: ChurchSnapshot;
}

export async function backupChurch(db: Database, churchId: string): Promise<Result<ChurchBackup>> {
  // `whenEmpty: "refuse"`: a backup must never bring a church into being by
  // looking for it. A church that exists but is empty is simply a new church
  // and backs up as one.
  const repository = createPostgresSnapshotRepository({
    db,
    churchId,
    createSeed: () => createSeedSnapshot(new Date()),
    whenEmpty: "refuse",
  });

  let loaded;
  try {
    loaded = await repository.load(FULL_SCOPE);
  } catch (error: unknown) {
    if (error instanceof ChurchNotReadyError) return err(error.message, error.code);
    throw error;
  }

  return ok({
    kind: BACKUP_KIND,
    schemaVersion: SCHEMA_VERSION,
    churchId,
    version: loaded.version,
    takenAt: new Date().toISOString(),
    data: loaded.snapshot,
  });
}

const backupSchema = z.object({
  kind: z.literal(BACKUP_KIND),
  schemaVersion: z.number(),
  churchId: z.string().min(1),
  version: z.number(),
  takenAt: z.string(),
  data: z.object({
    people: z.array(collectionSchemas.people),
    households: z.array(collectionSchemas.households),
    groups: z.array(collectionSchemas.groups),
    tasks: z.array(collectionSchemas.tasks),
    sessions: z.array(collectionSchemas.sessions),
    attendance: z.array(collectionSchemas.attendance),
    careRecords: z.array(collectionSchemas.careRecords),
    templates: z.array(collectionSchemas.templates),
    communications: z.array(collectionSchemas.communications),
    team: z.array(collectionSchemas.team),
    activity: z.array(collectionSchemas.activity),
    settings: churchSettingsSchema,
  }),
});

export function parseBackup(raw: unknown): Result<ChurchBackup> {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return err(`That is not a valid church backup${where}: ${issue?.message ?? "unknown problem"}.`, "invalid_input");
  }
  if (parsed.data.schemaVersion !== SCHEMA_VERSION) {
    return err(
      `That backup uses schema version ${parsed.data.schemaVersion}; this build reads version ${SCHEMA_VERSION}.`,
      "invalid_input",
    );
  }
  return ok(parsed.data as ChurchBackup);
}

export interface RestoreOutcome {
  churchId: string;
  /** The church's version after the restore. */
  version: number;
  counts: Record<string, number>;
}

/**
 * Replaces a church's data with a backup's, under the usual version guard
 * so a restore cannot silently overwrite a commit that landed meanwhile.
 * The backup's own `churchId` must match unless `allowDifferentChurch` is
 * set — restoring one congregation's records into another is a thing to do
 * on purpose, not by a typo.
 */
export async function restoreChurch(
  db: Database,
  churchId: string,
  raw: unknown,
  options: { allowDifferentChurch?: boolean } = {},
): Promise<Result<RestoreOutcome>> {
  const parsed = parseBackup(raw);
  if (!parsed.ok) return parsed;
  const backup = parsed.value;

  if (backup.churchId !== churchId && !options.allowDifferentChurch) {
    return err(
      `That backup is of church ${backup.churchId}, not ${churchId}. Pass allowDifferentChurch to restore it here anyway.`,
      "invalid_input",
    );
  }

  const repository = createPostgresSnapshotRepository({
    db,
    churchId,
    createSeed: () => createSeedSnapshot(new Date()),
  });

  // Only the version is needed, and reading it directly means the restore
  // never triggers a seed over a church that happens to be empty. A church
  // that does not exist yet is created by the ordinary load; its seed is
  // replaced in the next statement.
  const [row] = await db
    .select({ version: churches.version })
    .from(churches)
    .where(eq(churches.id, churchId));
  const version = row ? row.version : (await repository.load(FULL_SCOPE)).version;

  const saved = await repository.save(null, backup.data, version);
  if (!saved.ok) {
    return saved.code === CONFLICT
      ? err("The church changed while the restore was running. Try again.", CONFLICT)
      : saved;
  }

  const counts = Object.fromEntries(
    (Object.keys(backup.data) as Array<keyof ChurchSnapshot>)
      .filter((key) => Array.isArray(backup.data[key]))
      .map((key) => [key, (backup.data[key] as readonly unknown[]).length]),
  );

  return ok({ churchId, version: saved.value, counts });
}
