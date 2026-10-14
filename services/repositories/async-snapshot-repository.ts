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
/**
 * How much of a church a caller is allowed to read.
 *
 * This is applied in the query, not to the result: a scope without care
 * records does not fetch the table at all, so restricted information never
 * enters the process that would have to remember to drop it. Omit the scope
 * to read everything, which is what a command needs in order to be correct.
 */
export interface LoadScope {
  /** `false` leaves the care table unqueried. */
  careRecords: boolean;
  /** Every task, only one assignee's, or none at all. */
  tasks: "all" | "none" | { assigneeId: string };
}

export const FULL_SCOPE: LoadScope = { careRecords: true, tasks: "all" };

export interface AsyncSnapshotRepository {
  load(scope?: LoadScope): Promise<VersionedSnapshot>;
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
    options?: SaveOptions,
  ): Promise<Result<number>>;
  /** Wipes the church's data and writes a fresh seed. */
  reset(): Promise<VersionedSnapshot>;
  exportBundle(snapshot: ChurchSnapshot): ExportBundle;
  importBundle(raw: unknown, current: ChurchSnapshot): Result<ChurchSnapshot>;
}

export interface SaveOptions {
  /**
   * Extra work to perform inside the commit's own transaction.
   *
   * This exists for the transactional outbox: an email's queue row has to be
   * written with the record that caused it or not at all, otherwise there is a
   * window where a message is queued against a change that was rolled back —
   * or a change is committed whose email silently vanished.
   *
   * The handle is whatever the implementation uses for a transaction, so the
   * caller must know which repository it is talking to. That is deliberate:
   * enlisting in someone else's transaction is not a thing to do casually.
   */
  enlist?: (tx: unknown) => Promise<void>;
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
