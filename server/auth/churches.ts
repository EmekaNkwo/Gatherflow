import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { churches, churchMembers } from "@/server/db/schema";
import type { DemoRole } from "@/types/team";

/**
 * Which church an account is working in, when it belongs to more than one.
 *
 * The choice is a cookie: it names a church, nothing more, and the server
 * still checks the membership row on every request. A cookie naming a church
 * the account is not a member of is simply ignored, so a stale or forged
 * value cannot open anything and cannot lock anybody out.
 */
export const CHURCH_COOKIE = "gatherflow_church";

export interface Membership {
  churchId: string;
  churchName: string;
  role: DemoRole;
  teamMemberId: string | null;
}

export async function listMemberships(db: Database, userId: string): Promise<Membership[]> {
  const rows = await db
    .select({
      churchId: churchMembers.churchId,
      churchName: churches.name,
      role: churchMembers.role,
      teamMemberId: churchMembers.teamMemberId,
    })
    .from(churchMembers)
    .innerJoin(churches, eq(churches.id, churchMembers.churchId))
    .where(eq(churchMembers.userId, userId))
    .orderBy(churches.name);
  return rows;
}

/** The chosen church from the request's cookies, if any. */
export function readChurchCookie(headers: Headers): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CHURCH_COOKIE) {
      const value = rest.join("=").trim();
      return value ? safeDecode(value) : null;
    }
  }
  return null;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The `Set-Cookie` value that records a choice. Session-scoped, HttpOnly. */
export function churchCookie(churchId: string, secure: boolean): string {
  return [
    `${CHURCH_COOKIE}=${encodeURIComponent(churchId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearChurchCookie(): string {
  return `${CHURCH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Brings a church into being for the account that asked. One transaction's
 * worth of facts: the church row and its empty snapshot (with the founder
 * as its first team member), and the membership that makes the founder its
 * administrator.
 */
export async function createChurchForUser(
  db: Database,
  input: { userId: string; userName: string; churchName: string },
): Promise<{ churchId: string; teamMemberId: string }> {
  const { createEmptySnapshot } = await import("@/services/core/empty-church");
  const { createPostgresSnapshotRepository } = await import("@/server/db/snapshot-repository");
  const { createId } = await import("@/lib/ids");

  const churchId = createId("church");
  const teamMemberId = createId("tm");
  const snapshot = createEmptySnapshot({
    churchName: input.churchName,
    founder: { teamMemberId, name: input.userName },
  });

  await createPostgresSnapshotRepository({ db, churchId, createSeed: () => snapshot }).load();
  await db.insert(churchMembers).values({
    churchId,
    userId: input.userId,
    role: "administrator",
    teamMemberId,
  });

  return { churchId, teamMemberId };
}
