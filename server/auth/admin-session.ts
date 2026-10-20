import { headers } from "next/headers";
import { authorize } from "@/server/auth/authorize";
import { resolveChurchSession, type ChurchSession } from "@/server/auth/session";
import { getDatabase, type Database } from "@/server/db/client";
import type { Capability } from "@/types/team";

/**
 * A request's session, already checked for a capability. Shared by the
 * administration routes so each one says what it needs and nothing else.
 */
export type GuardedSession =
  | { ok: true; db: Database; session: ChurchSession }
  | { ok: false; db: Database; error: string; code?: string };

export async function guardedSession(capability: Capability): Promise<GuardedSession> {
  const db = getDatabase();
  const session = await resolveChurchSession({ db, headers: await headers() });
  if (!session.ok) return { ok: false, db, error: session.error, code: session.code };
  const permitted = authorize(session.value, capability);
  if (!permitted.ok) return { ok: false, db, error: permitted.error, code: permitted.code };
  return { ok: true, db, session: session.value };
}
