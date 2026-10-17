/** Bumped when a stored record's shape changes incompatibly. */
export const SCHEMA_VERSION = 1;

/** What a load had to drop, so the interface can say so. */
export interface LoadReport {
  /** Records that failed validation and were left out. */
  dropped: number;
  /** Human-readable explanations, one per collection with problems. */
  issues: string[];
}
