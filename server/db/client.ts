import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database connection.
 *
 * One pool per process, reused across hot reloads in development so a long
 * dev session does not accumulate connections until Postgres refuses new ones.
 */

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseOptions {
  connectionString: string;
  /** Keep small on serverless platforms, where every instance holds its own. */
  max?: number;
}

export function createDatabase({ connectionString, max = 10 }: DatabaseOptions) {
  const client = postgres(connectionString, {
    max,
    // Dates and numerics arrive as strings; every record is stored as jsonb
    // and validated by Zod, so no driver-level coercion is wanted here.
    prepare: false,
  });
  return drizzle(client, { schema });
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env.local and set it.",
    );
  }
  return url;
}

declare global {
  var __gatherflowDb: Database | undefined;
}

/** The shared connection, created on first use. */
export function getDatabase(): Database {
  if (!globalThis.__gatherflowDb) {
    globalThis.__gatherflowDb = createDatabase({
      connectionString: requireDatabaseUrl(),
    });
  }
  return globalThis.__gatherflowDb;
}
