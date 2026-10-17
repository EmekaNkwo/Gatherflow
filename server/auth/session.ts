import { err, ok, type Result } from "@/lib/result";
import type { DemoRole } from "@/types/team";
import type { Database } from "@/server/db/client";
import { getAuth } from "./auth";
import { listMemberships, readChurchCookie } from "./churches";

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
  /** How many churches the account belongs to; the interface offers a switch when more than one. */
  memberships: number;
}

export interface ResolveSessionInput {
  db: Database;
  /** Request headers, from `next/headers` or a test. */
  headers: Headers;
  /** An explicit choice; otherwise the church cookie, if any, is consulted. */
  churchId?: string;
}

/**
 * Resolves the acting session, or refuses.
 *
 * Fails closed at every step: no valid auth session, no membership, or an
 * ambiguous church all produce a refusal rather than a guess. A church named
 * explicitly or by cookie counts only if the account is actually a member of
 * it; otherwise it is as if nothing had been named.
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
  const all = await listMemberships(db, userId);

  if (all.length === 0) {
    return err("Your account is not linked to a church yet.", "no_membership");
  }

  if (churchId) {
    const explicit = all.find((entry) => entry.churchId === churchId);
    if (!explicit) return err("You do not have access to that church.", "no_membership");
    return ok(toSession(userId, explicit, all.length));
  }

  const chosen = readChurchCookie(headers);
  const byCookie = chosen ? all.find((entry) => entry.churchId === chosen) : undefined;
  if (byCookie) return ok(toSession(userId, byCookie, all.length));

  // More than one church and no valid choice made: refusing beats picking one
  // and showing somebody another congregation's records.
  if (all.length > 1) {
    return err("Choose which church to open.", "church_required");
  }

  return ok(toSession(userId, all[0], 1));
}

function toSession(
  userId: string,
  membership: Awaited<ReturnType<typeof listMemberships>>[number],
  memberships: number,
): ChurchSession {
  return {
    userId,
    churchId: membership.churchId,
    role: membership.role,
    teamMemberId: membership.teamMemberId,
    memberships,
  };
}
