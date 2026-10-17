import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Result } from "@/lib/result";
import type { Database } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

/**
 * The audit trail.
 *
 * Every server-side action that changes a church, or is refused trying to,
 * leaves one row: who (account and team member), what (an action name and a
 * target id), and how it ended. Writing it must never break the request it
 * describes, so a failure here is logged and swallowed — the action already
 * happened, and refusing to report it would not undo it.
 */

export const SYSTEM_USER = "system";

export type AuditOutcome = "ok" | "refused" | "failed";

export interface AuditEntry {
  churchId: string;
  userId: string;
  actorId?: string | null;
  action: string;
  targetId?: string | null;
  outcome: AuditOutcome;
  code?: string | null;
}

export async function recordAudit(db: Database, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: randomUUID(),
      churchId: entry.churchId,
      userId: entry.userId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetId: entry.targetId ?? null,
      outcome: entry.outcome,
      code: entry.code ?? null,
    });
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "audit.write_failed",
        action: entry.action,
        churchId: entry.churchId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Records the outcome of a `Result`, whichever way it went. */
export async function auditResult(
  db: Database,
  entry: Omit<AuditEntry, "outcome" | "code">,
  outcome: Result<unknown>,
): Promise<void> {
  await recordAudit(db, {
    ...entry,
    outcome: outcome.ok ? "ok" : FAILURE_CODES.has(outcome.code ?? "") ? "failed" : "refused",
    code: outcome.ok ? null : (outcome.code ?? "refused"),
  });
}

/** Codes that mean the system could not do it, as opposed to would not. */
const FAILURE_CODES = new Set(["storage_failed", "conflict", "transport"]);

/**
 * The id an action was about, read from its input without knowing its shape.
 * Only ids are kept: a body, a note or an address never reaches the table.
 */
export function targetOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const candidate = input as Record<string, unknown>;
  for (const key of [
    "personId",
    "taskId",
    "recordId",
    "careRecordId",
    "groupId",
    "householdId",
    "sessionId",
    "toSessionId",
    "attendanceId",
    "templateId",
    "teamMemberId",
    "assigneeId",
    "leaderId",
    "primaryContactId",
    "stageId",
    "appointmentId",
    "ruleId",
  ]) {
    const value = candidate[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export interface AuditRow {
  id: string;
  userId: string;
  actorId: string | null;
  action: string;
  targetId: string | null;
  outcome: string;
  code: string | null;
  at: string;
}

export async function recentAudit(
  db: Database,
  churchId: string,
  options: { limit?: number; sinceDays?: number } = {},
): Promise<AuditRow[]> {
  const limit = Math.min(options.limit ?? 100, 500);
  const since = options.sinceDays ?? 90;
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.churchId, churchId),
        gte(auditLog.at, sql`now() - make_interval(days => ${since})`),
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    actorId: row.actorId,
    action: row.action,
    targetId: row.targetId,
    outcome: row.outcome,
    code: row.code,
    at: new Date(row.at).toISOString(),
  }));
}
