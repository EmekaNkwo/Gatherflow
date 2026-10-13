import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { DemoRole } from "@/types/team";
import { churchMembers } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { getAuth } from "./auth";

/**
 * Who is acting, and in which church.
 *
 * Every field here is read from the server's own tables. Nothing is taken from
 * the request body, so a client cannot assert its own role or church — which
 * is the entire difference between this and the browser-side role switcher the
 * demo shell uses.
 */
export interface ChurchSession {
  userId: string;
  churchId: string;
  role: DemoRole;
  /** The `team` row this account acts as, when it has one. */
  teamMemberId: string | null;
}

export interface ResolveSessionInput {
  db: Database;
  /** Request headers, from `next/headers` or a test. */
  headers: Headers;
  /** Required only when the account belongs to more than one church. */
  churchId?: string;
}

/**
 * Resolves the acting session, or refuses.
 *
 * Fails closed at every step: no valid auth session, no membership, or an
 * ambiguous church all produce a refusal rather than a guess.
 */
export async function resolveChurchSession({
  db,
  headers,
  churchId,
}: ResolveSessionInput): Promise<Result<ChurchSession>> {
  const authSession = await getAuth().api.getSession({ headers });
  if (!authSession?.user?.id) {
    return err("You are not signed in.", "unauthenticated");
  }

  const userId = authSession.user.id;

  const memberships = await db
    .select({
      churchId: churchMembers.churchId,
      role: churchMembers.role,
      teamMemberId: churchMembers.teamMemberId,
    })
    .from(churchMembers)
    .where(
      churchId
        ? and(eq(churchMembers.userId, userId), eq(churchMembers.churchId, churchId))
        : eq(churchMembers.userId, userId),
    );

  if (memberships.length === 0) {
    return err(
      churchId
        ? "You do not have access to that church."
        : "Your account is not linked to a church yet.",
      "no_membership",
    );
  }

  // More than one church and no choice made: refusing beats picking one and
  // showing somebody another congregation's records.
  if (memberships.length > 1) {
    return err("Choose which church to open.", "church_required");
  }

  const membership = memberships[0];
  return ok({
    userId,
    churchId: membership.churchId,
    role: membership.role,
    teamMemberId: membership.teamMemberId,
  });
}
