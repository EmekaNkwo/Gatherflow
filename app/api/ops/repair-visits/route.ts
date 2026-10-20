import { recordAudit, SYSTEM_USER } from "@/server/audit/audit";
import { getDatabase } from "@/server/db/client";
import { bearerMatches } from "@/server/http/bearer";
import { respondErr, respondOk } from "@/server/http/respond";
import { repairVisits } from "@/server/ops/repair-visits";

/**
 * Corrects first-visit records saved before first visits were worked out
 * properly (see `services/attendance/repair.ts`).
 *
 *   curl -X POST -H "authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/ops/repair-visits?dryRun=1"          # every church, report only
 *   curl -X POST -H "authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/ops/repair-visits?church=<id>"       # one church, for real
 *
 * Safe to run more than once: a repaired church reports nothing to change.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected || !bearerMatches(request, expected)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const churchId = url.searchParams.get("church") ?? undefined;
  const dryRun = url.searchParams.get("dryRun") === "1";

  const db = getDatabase();
  const repaired = await repairVisits(db, { churchId, dryRun });
  if (!repaired.ok) return respondErr(repaired.error, repaired.code);

  if (!dryRun) {
    for (const report of repaired.value.filter((entry) => entry.saved || entry.error)) {
      await recordAudit(db, {
        churchId: report.churchId,
        userId: SYSTEM_USER,
        action: "ops.repairVisits",
        outcome: report.error ? "failed" : "ok",
        code: report.error ? "storage_failed" : null,
      });
    }
  }

  return respondOk({ dryRun, churches: repaired.value });
}
