import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { upsertTeamMember } from "@/services/settings/settings";
import { recordAudit } from "@/server/audit/audit";
import { runSystemCommand } from "@/server/church/commands";
import type { Database } from "@/server/db/client";
import { churches, churchMembers, invitations } from "@/server/db/schema";

/**
 * An account's own lifecycle: what has to be true before it can leave, and
 * what leaving does to the churches it belonged to.
 *
 * Deleting an account removes the person's sign-in and their memberships
 * (the rows cascade). It does not remove what they did: the team member they
 * acted as stays, inactive, so tasks and notes keep their attribution — the
 * same as when an administrator removes somebody from a church.
 */

/**
 * The churches that would be left without an administrator. Leaving one
 * behind would lock everybody out of its settings and its team, so deletion
 * is refused until somebody else holds the role.
 */
export async function deletionBlockers(db: Database, userId: string): Promise<string[]> {
  const administered = await db
    .select({ churchId: churchMembers.churchId, name: churches.name })
    .from(churchMembers)
    .innerJoin(churches, eq(churches.id, churchMembers.churchId))
    .where(and(eq(churchMembers.userId, userId), eq(churchMembers.role, "administrator")));
  if (administered.length === 0) return [];

  const others = await db
    .selectDistinct({ churchId: churchMembers.churchId })
    .from(churchMembers)
    .where(
      and(
        inArray(
          churchMembers.churchId,
          administered.map((entry) => entry.churchId),
        ),
        eq(churchMembers.role, "administrator"),
        ne(churchMembers.userId, userId),
      ),
    );
  const covered = new Set(others.map((entry) => entry.churchId));
  return administered.filter((entry) => !covered.has(entry.churchId)).map((entry) => entry.name);
}

export function blockerMessage(churchNames: readonly string[]): string {
  const named = churchNames.join(", ");
  return (
    `You are the only administrator of ${named}. ` +
    "Make somebody else an administrator there first, so the church is not left without one."
  );
}

export interface DepartedMembership {
  churchId: string;
  teamMemberId: string | null;
}

/**
 * Takes the account out of every church, or refuses because a church would
 * be left without an administrator.
 *
 * One transaction, holding a lock on the administrator rows of every church
 * the account administers. Two administrators of the same church deleting
 * their accounts at the same moment are therefore serialised: the second
 * waits, then sees that the first has already gone, and is refused. The
 * memberships are removed here rather than left to the cascade, so the check
 * and the removal cannot be separated. Invitations the account sent and that
 * are still open are withdrawn with it.
 */
export async function leaveChurches(db: Database, userId: string): Promise<Result<DepartedMembership[]>> {
  return db.transaction(async (tx) => {
    const memberships = await tx
      .select({ churchId: churchMembers.churchId, role: churchMembers.role, teamMemberId: churchMembers.teamMemberId })
      .from(churchMembers)
      .where(eq(churchMembers.userId, userId));
    const administered = memberships.filter((entry) => entry.role === "administrator").map((entry) => entry.churchId);

    if (administered.length) {
      await tx
        .select({ userId: churchMembers.userId })
        .from(churchMembers)
        .where(and(inArray(churchMembers.churchId, administered), eq(churchMembers.role, "administrator")))
        .orderBy(asc(churchMembers.churchId), asc(churchMembers.userId))
        .for("update");
      const blockers = await deletionBlockers(tx as unknown as Database, userId);
      if (blockers.length) return err(blockerMessage(blockers), "last_administrator");
    }

    await tx.delete(churchMembers).where(eq(churchMembers.userId, userId));
    await tx.delete(invitations).where(eq(invitations.invitedBy, userId));
    return ok(memberships.map(({ churchId, teamMemberId }) => ({ churchId, teamMemberId })));
  });
}

/**
 * Marks the departed account's team members inactive in every church it
 * belonged to, and records the departure in each church's audit trail.
 */
export async function retireAccount(
  db: Database,
  userId: string,
  memberships: readonly DepartedMembership[],
): Promise<void> {
  for (const membership of memberships) {    const teamMemberId = membership.teamMemberId;
    let outcome: "ok" | "failed" = "ok";
    if (teamMemberId) {
      const retired = await runSystemCommand(db, membership.churchId, (snapshot, ctx) => {
        const member = snapshot.team.find((entry) => entry.id === teamMemberId);
        if (!member || !member.active) return ok({ snapshot, events: [], notices: [] });
        return upsertTeamMember(
          snapshot,
          { id: member.id, name: member.name, role: member.role, title: member.title, active: false },
          ctx,
        );
      });
      if (!retired.ok) {
        outcome = "failed";
        console.error(
          JSON.stringify({
            at: new Date().toISOString(),
            event: "account.retire.failed",
            churchId: membership.churchId,
            error: retired.error,
          }),
        );
      }
    }
    await recordAudit(db, {
      churchId: membership.churchId,
      userId,
      actorId: teamMemberId,
      action: "account.delete",
      targetId: teamMemberId ?? userId,
      outcome,
    });
  }
}
