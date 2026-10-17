import { recordAudit, SYSTEM_USER } from "@/server/audit/audit";
import { getDatabase } from "@/server/db/client";
import { backupChurch } from "@/server/ops/backup";
import { bearerMatches } from "@/server/http/bearer";
import { respondErr } from "@/server/http/respond";

/**
 * A whole church, for an operator to keep somewhere safe.
 *
 *   curl -H "authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/ops/backup?church=<id>" > church.json
 *
 * Behind the operator secret, not a role: the file includes pastoral care,
 * which no role is allowed to export.
 */
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected || !bearerMatches(request, expected)) {
    return new Response("Not found", { status: 404 });
  }

  const churchId = new URL(request.url).searchParams.get("church");
  if (!churchId) return respondErr("Say which church: ?church=<id>.", "invalid_input");

  const db = getDatabase();
  let backup: Awaited<ReturnType<typeof backupChurch>>;
  try {
    backup = await backupChurch(db, churchId);
  } catch (error: unknown) {
    await recordAudit(db, { churchId, userId: SYSTEM_USER, action: "ops.backup", outcome: "failed", code: "storage_failed" });
    const message = error instanceof Error ? error.message : String(error);
    return respondErr(`The backup could not be taken: ${message}`, "storage_failed");
  }
  // The audit row needs a church that exists; a refused backup of a missing
  // church has nowhere to be recorded, and nothing happened anyway.
  if (backup.ok || backup.code !== "not_found") {
    await recordAudit(db, {
      churchId,
      userId: SYSTEM_USER,
      action: "ops.backup",
      outcome: backup.ok ? "ok" : "refused",
      code: backup.ok ? null : backup.code,
    });
  }
  if (!backup.ok) return respondErr(backup.error, backup.code);

  const safeId = churchId.replace(/[^\w.-]/g, "_").slice(0, 80);
  const filename = `gatherflow-${safeId}-${backup.value.takenAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  return new Response(JSON.stringify(backup.value), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
