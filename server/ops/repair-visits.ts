import { createSeedSnapshot } from "@/data/seed";
import { eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { repairVisitRecords } from "@/services/attendance/repair";
import { result } from "@/services/core/events";
import { runSystemCommand } from "@/server/church/commands";
import type { Database } from "@/server/db/client";
import { churches } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";

/**
 * Applies `repairVisitRecords` to stored churches. A dry run reports what
 * would change and saves nothing. A real run goes through the ordinary
 * versioned save, so it cannot overwrite work saved while it was running.
 */
export interface ChurchRepairReport {
  churchId: string;
  correctedDates: string[];
  correctedFlags: number;
  saved: boolean;
  /** Set when this church could not be repaired; the others still are. */
  error?: string;
}

export async function repairVisits(
  db: Database,
  options: { churchId?: string; dryRun: boolean },
): Promise<Result<ChurchRepairReport[]>> {
  // Only churches that exist: the save path would otherwise create one.
  const ids = (
    await (options.churchId
      ? db.select({ id: churches.id }).from(churches).where(eq(churches.id, options.churchId))
      : db.select({ id: churches.id }).from(churches))
  ).map((row) => row.id);
  if (options.churchId && !ids.length) return err("There is no church with that id.", "not_found");

  const reports: ChurchRepairReport[] = [];
  for (const churchId of ids) {
    reports.push(await repairOne(db, churchId, options.dryRun));
  }
  return ok(reports);
}

async function repairOne(db: Database, churchId: string, dryRun: boolean): Promise<ChurchRepairReport> {
  if (dryRun) {
    const repository = createPostgresSnapshotRepository({
      db,
      churchId,
      createSeed: () => createSeedSnapshot(new Date()),
      whenEmpty: "refuse",
    });
    const loaded = await repository.load();
    const { correctedDates, correctedFlags } = repairVisitRecords(loaded.snapshot);
    return { churchId, correctedDates, correctedFlags, saved: false };
  }

  let report: ChurchRepairReport = { churchId, correctedDates: [], correctedFlags: 0, saved: false };
  const outcome = await runSystemCommand(db, churchId, (snapshot) => {
    const repair = repairVisitRecords(snapshot);
    report = { churchId, correctedDates: repair.correctedDates, correctedFlags: repair.correctedFlags, saved: false };
    return ok(result(repair.snapshot));
  });
  if (!outcome.ok) return { ...report, error: outcome.error };
  const changed = report.correctedDates.length > 0 || report.correctedFlags > 0;
  return { ...report, saved: changed };
}
