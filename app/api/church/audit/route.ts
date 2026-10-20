import { headers } from "next/headers";
import { recentAudit } from "@/server/audit/audit";
import { authorize } from "@/server/auth/authorize";
import { resolveChurchSession } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { respondErr, respondOk } from "@/server/http/respond";

/** The church's audit trail, for an administrator. Ids and outcomes only. */
export async function GET(request: Request): Promise<Response> {
  const db = getDatabase();
  const session = await resolveChurchSession({ db, headers: await headers() });
  if (!session.ok) return respondErr(session.error, session.code);

  const permitted = authorize(session.value, "settings.write");
  if (!permitted.ok) return respondErr(permitted.error, permitted.code);

  const limit = Math.floor(Number(new URL(request.url).searchParams.get("limit") ?? 100));
  const entries = await recentAudit(db, session.value.churchId, {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
  });
  return respondOk({ entries });
}
