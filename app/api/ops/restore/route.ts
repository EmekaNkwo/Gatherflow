import { recordAudit, SYSTEM_USER } from "@/server/audit/audit";
import { getDatabase } from "@/server/db/client";
import { restoreChurch } from "@/server/ops/backup";
import { bearerMatches } from "@/server/http/bearer";
import { respondErr, respondOk } from "@/server/http/respond";

const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Puts a backup back.
 *
 *   curl -X POST -H "authorization: Bearer $CRON_SECRET" \
 *     -H "content-type: application/json" --data-binary @church.json \
 *     "https://<host>/api/ops/restore?church=<id>"
 *
 * Replaces everything the church has. The backup's church id must match the
 * target unless `&allowDifferentChurch=1` says otherwise.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected || !bearerMatches(request, expected)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const churchId = url.searchParams.get("church");
  if (!churchId) return respondErr("Say which church: ?church=<id>.", "invalid_input");

  // A declared size is required: a chunked body has no ceiling to check.
  const declared = request.headers.get("content-length");
  const length = Number(declared);
  if (!declared || !Number.isFinite(length) || length > MAX_BODY_BYTES) {
    return respondErr("Send the backup with a Content-Length of at most 64 MB.", "invalid_input");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }

  const db = getDatabase();
  let outcome: Awaited<ReturnType<typeof restoreChurch>>;
  try {
    outcome = await restoreChurch(db, churchId, raw, {
      allowDifferentChurch: url.searchParams.get("allowDifferentChurch") === "1",
    });
  } catch (error: unknown) {
    await recordAudit(db, { churchId, userId: SYSTEM_USER, action: "ops.restore", outcome: "failed", code: "storage_failed" });
    const message = error instanceof Error ? error.message : String(error);
    return respondErr(`The restore could not be completed: ${message}`, "storage_failed");
  }
  await recordAudit(db, {
    churchId,
    userId: SYSTEM_USER,
    action: "ops.restore",
    outcome: outcome.ok ? "ok" : "refused",
    code: outcome.ok ? null : outcome.code,
  });

  if (!outcome.ok) return respondErr(outcome.error, outcome.code);
  console.info(
    JSON.stringify({ at: new Date().toISOString(), event: "ops.restore", ...outcome.value }),
  );
  return respondOk(outcome.value);
}
