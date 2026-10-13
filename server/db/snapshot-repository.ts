import { and, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import {
  CONFLICT,
  FULL_SCOPE,
  type AsyncSnapshotRepository,
  type LoadScope,
  type VersionedSnapshot,
} from "@/services/repositories/async-snapshot-repository";
import { buildExportBundle, parseImportBundle } from "@/services/repositories/bundle";
import { SCHEMA_VERSION, type LoadReport } from "@/services/repositories/collection";
import {
  churchSettingsSchema,
  collectionSchemas,
  type CollectionName,
} from "@/services/repositories/schema";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { Database } from "./client";
import {
  activity,
  attendance,
  careRecords,
  churches,
  churchSettings,
  communications,
  groups,
  households,
  people,
  sessions,
  tasks,
  team,
  templates,
} from "./schema";

/**
 * Postgres implementation of the snapshot seam.
 *
 * Two properties carry over from the browser repository, because they are what
 * make the application resilient rather than incidental details:
 *
 * - **Validation on read.** Every row's `data` is parsed with the same Zod
 *   schema the browser uses. A row that fails is dropped and counted, never
 *   thrown, so one malformed record cannot lock a church out of its own data.
 * - **Only what changed is written.** A commit compares array references and
 *   rewrites just those collections, so registering a visitor does not rewrite
 *   ten weeks of attendance.
 *
 * Added here, because a shared database makes them necessary:
 *
 * - **Optimistic concurrency.** `churches.version` is the guard. Two
 *   volunteers completing tasks at the same time cannot silently overwrite
 *   each other; the loser is told to reload.
 * - **One transaction per commit.** Readers never observe a half-written
 *   church.
 */

/** Rows per insert statement, to stay well clear of the parameter limit. */
const INSERT_CHUNK = 500;

export interface PostgresSnapshotRepositoryOptions {
  db: Database;
  churchId: string;
  createSeed: () => ChurchSnapshot;
}

/**
 * Derives the promoted columns from a record.
 *
 * Every promoted column is computed here and nowhere else, so a column can
 * never disagree with the `data` it was taken from.
 */
const promote = {
  people: (churchId: string, r: ChurchSnapshot["people"][number]) => ({
    churchId,
    id: r.id,
    kind: r.kind,
    email: r.email ?? null,
    phone: r.phone ?? null,
    householdId: r.householdId ?? null,
    optedOut: r.contact.optedOut,
    permissionGranted: r.contact.permissionGranted,
    data: r,
  }),
  households: (churchId: string, r: ChurchSnapshot["households"][number]) => ({
    churchId,
    id: r.id,
    data: r,
  }),
  groups: (churchId: string, r: ChurchSnapshot["groups"][number]) => ({
    churchId,
    id: r.id,
    active: r.active,
    involvesMinors: r.involvesMinors,
    data: r,
  }),
  tasks: (churchId: string, r: ChurchSnapshot["tasks"][number]) => ({
    churchId,
    id: r.id,
    personId: r.personId,
    assigneeId: r.assigneeId ?? null,
    status: r.status,
    dueDate: r.dueDate,
    automationKey: r.automationKey ?? null,
    data: r,
  }),
  sessions: (churchId: string, r: ChurchSnapshot["sessions"][number]) => ({
    churchId,
    id: r.id,
    date: r.date,
    type: r.type,
    data: r,
  }),
  attendance: (churchId: string, r: ChurchSnapshot["attendance"][number]) => ({
    churchId,
    id: r.id,
    sessionId: r.sessionId,
    personId: r.personId,
    status: r.status,
    data: r,
  }),
  careRecords: (churchId: string, r: ChurchSnapshot["careRecords"][number]) => ({
    churchId,
    id: r.id,
    personId: r.personId,
    assigneeId: r.assigneeId ?? null,
    status: r.status,
    data: r,
  }),
  templates: (churchId: string, r: ChurchSnapshot["templates"][number]) => ({
    churchId,
    id: r.id,
    category: r.category,
    builtIn: r.builtIn,
    data: r,
  }),
  communications: (churchId: string, r: ChurchSnapshot["communications"][number]) => ({
    churchId,
    id: r.id,
    personId: r.personId,
    channel: r.channel,
    status: r.status,
    at: r.at,
    data: r,
  }),
  team: (churchId: string, r: ChurchSnapshot["team"][number]) => ({
    churchId,
    id: r.id,
    role: r.role,
    active: r.active,
    data: r,
  }),
  activity: (churchId: string, r: ChurchSnapshot["activity"][number]) => ({
    churchId,
    id: r.id,
    category: r.category,
    visibility: r.visibility,
    at: r.at,
    data: r,
  }),
} as const;

const tableFor = {
  people,
  households,
  groups,
  tasks,
  sessions,
  attendance,
  careRecords,
  templates,
  communications,
  team,
  activity,
} as const;

const COLLECTIONS = Object.keys(tableFor) as CollectionName[];

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createPostgresSnapshotRepository({
  db,
  churchId,
  createSeed,
}: PostgresSnapshotRepositoryOptions): AsyncSnapshotRepository {
  /**
   * Reads one collection, dropping rows whose `data` no longer satisfies the
   * schema and reporting how many were lost.
   */
  async function loadCollection<T extends { id: string }>(
    name: CollectionName,
    report: LoadReport,
    extra?: SQL | undefined,
  ): Promise<T[]> {
    const table = tableFor[name];
    const rows = await db
      .select({ data: table.data })
      .from(table)
      .where(extra ? and(eq(table.churchId, churchId), extra) : eq(table.churchId, churchId))
      // Without an explicit order Postgres may return rows in any order, which
      // would make a reload reshuffle every list in the interface. Ordering by
      // id keeps a load reproducible, which the reported figures depend on.
      .orderBy(table.id);

    const schema = collectionSchemas[name] as unknown as z.ZodType<T>;
    const items: T[] = [];
    let dropped = 0;

    for (const row of rows) {
      const parsed = schema.safeParse(row.data);
      if (parsed.success) {
        items.push(parsed.data);
      } else {
        dropped += 1;
      }
    }

    if (dropped > 0) {
      report.dropped += dropped;
      report.issues.push(
        `${dropped} invalid ${name} record${dropped === 1 ? "" : "s"} were ignored.`,
      );
    }

    return items;
  }

  /** Replaces a collection's rows for this church. Caller supplies the transaction. */
  async function writeCollection(
    tx: Database,
    name: CollectionName,
    items: readonly { id: string }[],
  ): Promise<void> {
    const table = tableFor[name];
    // The collection in the snapshot is the authority, so the stored rows are
    // replaced wholesale. Delete-then-insert mirrors `saveAll` exactly and
    // cannot leave a removed record behind; it runs inside the commit's
    // transaction, so no reader sees the gap. A diffing upsert would touch
    // fewer rows and is where to go if a collection ever grows large.
    await tx.delete(table).where(eq(table.churchId, churchId));
    if (items.length === 0) return;

    const mapRow = promote[name] as (c: string, r: unknown) => Record<string, unknown>;
    for (const batch of chunk(items, INSERT_CHUNK)) {
      await tx
        .insert(table)
        .values(batch.map((item) => mapRow(churchId, item)) as never);
    }
  }

  async function writeAll(tx: Database, snapshot: ChurchSnapshot): Promise<void> {
    for (const name of COLLECTIONS) {
      await writeCollection(tx, name, snapshot[name]);
    }
    await tx
      .insert(churchSettings)
      .values({ churchId, data: snapshot.settings })
      .onConflictDoUpdate({
        target: churchSettings.churchId,
        set: { data: snapshot.settings, updatedAt: new Date() },
      });
  }

  /** Creates the church row and seed data. Returns the seeded snapshot. */
  async function seed(): Promise<VersionedSnapshot> {
    const snapshot = createSeed();
    await db.transaction(async (tx) => {
      await tx
        .insert(churches)
        .values({
          id: churchId,
          name: snapshot.settings.churchName,
          version: 1,
          schemaVersion: SCHEMA_VERSION,
        })
        .onConflictDoUpdate({
          target: churches.id,
          set: { version: 1, schemaVersion: SCHEMA_VERSION, updatedAt: new Date() },
        });
      await writeAll(tx as unknown as Database, snapshot);
    });
    return { snapshot, version: 1, seeded: true, report: { dropped: 0, issues: [] } };
  }

  return {
    async load(scope: LoadScope = FULL_SCOPE): Promise<VersionedSnapshot> {
      const [church] = await db
        .select({ version: churches.version })
        .from(churches)
        .where(eq(churches.id, churchId));

      if (!church) return seed();

      const report: LoadReport = { dropped: 0, issues: [] };

      const [settingsRow] = await db
        .select({ data: churchSettings.data })
        .from(churchSettings)
        .where(eq(churchSettings.churchId, churchId));

      const settings = settingsRow ? churchSettingsSchema.safeParse(settingsRow.data) : null;
      if (settingsRow && !settings?.success) {
        report.issues.push("Stored settings were invalid and the defaults were restored.");
      }

      const loadedPeople = await loadCollection<ChurchSnapshot["people"][number]>(
        "people",
        report,
      );

      // People and settings are the backbone: without them there is nothing
      // meaningful to restore, so a fresh seed is written instead of a half
      // state. This matches the browser repository exactly.
      if (loadedPeople.length === 0 || !settings?.success) {
        return seed();
      }

      const fallback = createSeed();

      // The scope becomes SQL. `tasks: "none"` and `careRecords: false` skip
      // their queries entirely, so a caller without the capability does not
      // receive the rows at all — there is nothing to forget to filter later.
      const taskFilter: SQL | undefined =
        scope.tasks === "all"
          ? undefined
          : scope.tasks === "none"
            ? sql`false`
            : eq(tasks.assigneeId, scope.tasks.assigneeId);

      const [
        householdRows,
        groupRows,
        taskRows,
        sessionRows,
        attendanceRows,
        careRows,
        templateRows,
        communicationRows,
        teamRows,
        activityRows,
      ] = await Promise.all([
        loadCollection<ChurchSnapshot["households"][number]>("households", report),
        loadCollection<ChurchSnapshot["groups"][number]>("groups", report),
        loadCollection<ChurchSnapshot["tasks"][number]>("tasks", report, taskFilter),
        loadCollection<ChurchSnapshot["sessions"][number]>("sessions", report),
        loadCollection<ChurchSnapshot["attendance"][number]>("attendance", report),
        scope.careRecords
          ? loadCollection<ChurchSnapshot["careRecords"][number]>("careRecords", report)
          : Promise.resolve([]),
        loadCollection<ChurchSnapshot["templates"][number]>("templates", report),
        loadCollection<ChurchSnapshot["communications"][number]>("communications", report),
        loadCollection<ChurchSnapshot["team"][number]>("team", report),
        loadCollection<ChurchSnapshot["activity"][number]>("activity", report),
      ]);

      return {
        snapshot: {
          people: loadedPeople,
          settings: settings.data,
          households: householdRows,
          groups: groupRows,
          tasks: taskRows,
          sessions: sessionRows,
          attendance: attendanceRows,
          careRecords: careRows,
          templates: templateRows.length ? templateRows : fallback.templates,
          communications: communicationRows,
          team: teamRows.length ? teamRows : fallback.team,
          activity: activityRows,
        },
        version: church.version,
        seeded: false,
        report,
      };
    },

    async save(previous, next, expectedVersion): Promise<Result<number>> {
      try {
        return await db.transaction(async (tx) => {
          // The guard and the increment are the same statement, so two
          // concurrent commits cannot both believe they won.
          const bumped = await tx
            .update(churches)
            .set({ version: sql`${churches.version} + 1`, updatedAt: new Date() })
            .where(and(eq(churches.id, churchId), eq(churches.version, expectedVersion)))
            .returning({ version: churches.version });

          if (bumped.length === 0) {
            return err(
              "Someone else saved a change while you were working. Reload to see their version before saving again.",
              CONFLICT,
            );
          }

          const scoped = tx as unknown as Database;
          if (!previous) {
            await writeAll(scoped, next);
          } else {
            for (const name of COLLECTIONS) {
              if (previous[name] !== next[name]) {
                await writeCollection(scoped, name, next[name]);
              }
            }
            if (previous.settings !== next.settings) {
              await scoped
                .insert(churchSettings)
                .values({ churchId, data: next.settings })
                .onConflictDoUpdate({
                  target: churchSettings.churchId,
                  set: { data: next.settings, updatedAt: new Date() },
                });
            }
          }

          return ok(bumped[0].version);
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown database error";
        return err(`The change could not be saved: ${message}`, "storage_failed");
      }
    },

    async reset(): Promise<VersionedSnapshot> {
      // Collection rows cascade from the church row, so one delete clears
      // everything this church owns and nothing another church owns.
      await db.delete(churches).where(eq(churches.id, churchId));
      return seed();
    },

    exportBundle(snapshot) {
      return buildExportBundle(snapshot, new Date().toISOString());
    },

    importBundle(raw, current) {
      return parseImportBundle(raw, current);
    },
  };
}
