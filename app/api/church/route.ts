import { headers } from "next/headers";
import { resolveChurchSession } from "@/server/auth/session";
import { readChurch } from "@/server/church/commands";
import { getDatabase } from "@/server/db/client";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * The church, as the signed-in session is allowed to see it.
 *
 * The scope is not a parameter: it is derived from the membership row, so
 * there is no way for a request to ask for more than its role permits.
 */
export async function GET(): Promise<Response> {
  const db = getDatabase();

  const session = await resolveChurchSession({ db, headers: await headers() });
  if (!session.ok) return respondErr(session.error, session.code);

  const loaded = await readChurch({ db, session: session.value });

  return respondOk({
    snapshot: loaded.snapshot,
    version: loaded.version,
    seeded: loaded.seeded,
    report: loaded.report,
  });
}
