import type { Result } from "@/lib/result";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { LoadReport } from "./collection";
import type { ExportBundle } from "./bundle";

/**
 * The persistence seam for a networked store.
 *
 * `StorageAdapter` is deliberately synchronous — it exists so the browser and
 * the unit tests can share one code path — which is exactly why a database
 * cannot sit behind it. The seam for a database is one level up, here, where
 * the unit of work is a whole snapshot and the operations can be awaited.
 *
 * The semantics are otherwise the same as `SnapshotRepository`: records that
 * fail validation are dropped and reported rather than throwing, and only the
 * collections that actually changed are written.
 */
export interface AsyncSnapshotRepository {
  load(): Promise<VersionedSnapshot>;
  /**
   * Commits a snapshot, guarded by the version the caller read.
   *
   * Returns the new version on success, or a `conflict` refusal when another
   * writer has committed in the meantime — the caller reloads and retries
   * rather than overwriting work it never saw.
   */
  save(
    previous: ChurchSnapshot | null,
    next: ChurchSnapshot,
    expectedVersion: number,
  ): Promise<Result<number>>;
  /** Wipes the church's data and writes a fresh seed. */
  reset(): Promise<VersionedSnapshot>;
  exportBundle(snapshot: ChurchSnapshot): ExportBundle;
  importBundle(raw: unknown, current: ChurchSnapshot): Result<ChurchSnapshot>;
}

export interface VersionedSnapshot {
  snapshot: ChurchSnapshot;
  /** The value a subsequent `save` must present as its guard. */
  version: number;
  /** `true` when seed data was written because nothing valid was stored. */
  seeded: boolean;
  report: LoadReport;
}

/** Refusal code returned when an optimistic-concurrency guard fails. */
export const CONFLICT = "conflict";
