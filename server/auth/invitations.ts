import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { upsertTeamMember } from "@/services/settings/settings";
import type { DemoRole } from "@/types/team";
import type { Database } from "@/server/db/client";
import { churches, churchMembers, invitations } from "@/server/db/schema";
import { runSystemCommand } from "@/server/church/commands";

/**
 * Invitations.
 *
 * An administrator invites an address to a role; the person follows a link,
 * signs in or signs up with that address, and accepts. Accepting creates the
 * membership and — unless the invitation attached them to an existing team
 * member — a team member for them, so work can be assigned to them at once.
 *
 * The link carries a random token; the table keeps only its hash, so a read
 * of the database does not hand out working links.
 */

export const INVITATION_DAYS = 7;

export interface InvitationSummary {
  id: string;
  email: string;
  role: DemoRole;
  teamMemberId: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;
}

export async function createInvitation(
  db: Database,
  input: {
    churchId: string;
    email: string;
    role: DemoRole;
    teamMemberId?: string | null;
    invitedBy: string;
  },
): Promise<Result<{ token: string; invitation: InvitationSummary }>> {
  const email = input.email.trim().toLowerCase();
  if (!email) return err("An email address is needed.", "invalid_input");
  if (input.role === "member") {
    return err("Members do not sign in; invite people to a working role.", "invalid_input");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60_000);
  const [row] = await db
    .insert(invitations)
    .values({
      id: hashToken(token),
      churchId: input.churchId,
      email,
      role: input.role,
      teamMemberId: input.teamMemberId ?? null,
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning();

  return ok({ token, invitation: summarise(row) });
}

export async function listInvitations(db: Database, churchId: string): Promise<InvitationSummary[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.churchId, churchId), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.createdAt));
  return rows.map(summarise);
}

export async function revokeInvitation(
  db: Database,
  churchId: string,
  invitationId: string,
): Promise<boolean> {
  const removed = await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.churchId, churchId),
        isNull(invitations.acceptedAt),
      ),
    )
    .returning({ id: invitations.id });
  return removed.length > 0;
}

export interface OpenInvitation {
  id: string;
  churchId: string;
  churchName: string;
  email: string;
  role: DemoRole;
  teamMemberId: string | null;
  expiresAt: Date;
}

/** Looks an invitation up by its token, refusing anything not currently usable. */
export async function findOpenInvitation(
  db: Database,
  token: string,
): Promise<Result<OpenInvitation>> {
  if (!token) return err("That invitation link is incomplete.", "invalid_link");
  const [row] = await db
    .select({
      id: invitations.id,
      churchId: invitations.churchId,
      churchName: churches.name,
      email: invitations.email,
      role: invitations.role,
      teamMemberId: invitations.teamMemberId,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .innerJoin(churches, eq(churches.id, invitations.churchId))
    .where(eq(invitations.id, hashToken(token)));

  if (!row) return err("That invitation does not exist or was withdrawn.", "not_found");
  if (row.acceptedAt) return err("That invitation has already been used.", "used");
  if (row.expiresAt.getTime() < Date.now()) return err("That invitation has expired. Ask to be invited again.", "expired");
  return ok(row);
}

/**
 * Accepts on behalf of a signed-in account.
 *
 * The account's address must match the invitation's: the link proves that
 * somebody received the invitation, the address proves it is the person it
 * was sent to.
 */
export async function acceptInvitation(
  db: Database,
  token: string,
  account: { userId: string; email: string; name: string },
): Promise<Result<{ churchId: string; role: DemoRole; teamMemberId: string }>> {
  const open = await findOpenInvitation(db, token);
  if (!open.ok) return open;
  const invitation = open.value;

  if (invitation.email !== account.email.trim().toLowerCase()) {
    return err(
      `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      "wrong_account",
    );
  }

  const [existing] = await db
    .select({ role: churchMembers.role })
    .from(churchMembers)
    .where(and(eq(churchMembers.churchId, invitation.churchId), eq(churchMembers.userId, account.userId)));
  if (existing) return err("You already belong to this church.", "already_member");

  // The team member the account acts as: the one named by the invitation,
  // or a new one in the invited role. The command mints the new member's id,
  // so it is read back from the snapshot the command returned.
  let teamMemberId = invitation.teamMemberId;
  let before = new Set<string>();
  const ensured = await runSystemCommand(db, invitation.churchId, (snapshot, ctx) => {
    before = new Set(snapshot.team.map((member) => member.id));
    if (teamMemberId && before.has(teamMemberId)) {
      return ok({ snapshot, events: [], notices: [] });
    }
    return upsertTeamMember(
      snapshot,
      { name: account.name.trim() || invitation.email, role: invitation.role, active: true },
      ctx,
    );
  });
  if (!ensured.ok) return ensured;
  if (!teamMemberId || !before.has(teamMemberId)) {
    const created = ensured.value.snapshot.team.find((member) => !before.has(member.id));
    if (!created) return err("The team member could not be created.", "storage_failed");
    teamMemberId = created.id;
  }

  await db.transaction(async (tx) => {
    await tx.insert(churchMembers).values({
      churchId: invitation.churchId,
      userId: account.userId,
      role: invitation.role,
      teamMemberId,
    });
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: account.userId })
      .where(eq(invitations.id, invitation.id));
  });

  return ok({ churchId: invitation.churchId, role: invitation.role, teamMemberId: teamMemberId as string });
}

function summarise(row: typeof invitations.$inferSelect): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    teamMemberId: row.teamMemberId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
  };
}
