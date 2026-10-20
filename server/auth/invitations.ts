import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { upsertTeamMember } from "@/services/settings/settings";
import type { DemoRole } from "@/types/team";
import type { Database } from "@/server/db/client";
import { churches, churchMembers, invitations, user } from "@/server/db/schema";
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

  const clash = await findClash(db, input.churchId, email, input.teamMemberId ?? null);
  if (clash) return clash;

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

/**
 * Why a new invitation would only cause trouble later, if it would: a second
 * open invitation for the same address (the two could carry different roles),
 * an address that already has an account here (it would fail at accept), or a
 * team member another account or invitation already speaks for.
 */
async function findClash(
  db: Database,
  churchId: string,
  email: string,
  teamMemberId: string | null,
): Promise<Result<never> | null> {
  const open = and(
    eq(invitations.churchId, churchId),
    isNull(invitations.acceptedAt),
    gt(invitations.expiresAt, new Date()),
  );

  const [pending] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(open, eq(invitations.email, email)));
  if (pending) {
    return err(
      `${email} already has an invitation waiting. Withdraw it first if you want to send a new one.`,
      "duplicate",
    );
  }

  const [member] = await db
    .select({ userId: churchMembers.userId })
    .from(churchMembers)
    .innerJoin(user, eq(user.id, churchMembers.userId))
    .where(and(eq(churchMembers.churchId, churchId), sql`lower(${user.email}) = ${email}`));
  if (member) return err(`${email} already has an account in this church.`, "already_member");

  if (teamMemberId) {
    const [linked] = await db
      .select({ userId: churchMembers.userId })
      .from(churchMembers)
      .where(and(eq(churchMembers.churchId, churchId), eq(churchMembers.teamMemberId, teamMemberId)));
    if (linked) return err("That team member already signs in with another account.", "duplicate");

    const [invited] = await db
      .select({ email: invitations.email })
      .from(invitations)
      .where(and(open, eq(invitations.teamMemberId, teamMemberId)));
    if (invited) {
      return err(`That team member already has an invitation waiting, sent to ${invited.email}.`, "duplicate");
    }
  }
  return null;
}

export async function listInvitations(db: Database, churchId: string): Promise<InvitationSummary[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.churchId, churchId), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.createdAt));
  return rows.map(summarise);
}

/** Withdraws an open invitation; returns who it was for, or `null` if there was none. */
export async function revokeInvitation(
  db: Database,
  churchId: string,
  invitationId: string,
): Promise<{ email: string; role: DemoRole } | null> {
  const removed = await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.churchId, churchId),
        isNull(invitations.acceptedAt),
      ),
    )
    .returning({ email: invitations.email, role: invitations.role });
  return removed[0] ?? null;
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
  // so it is read back from the snapshot the command returned. An existing
  // team member takes the invited role and is switched back on, so what the
  // team list says and what the account may do agree from the start.
  let teamMemberId = invitation.teamMemberId;
  let before = new Set<string>();
  const ensured = await runSystemCommand(db, invitation.churchId, (snapshot, ctx) => {
    before = new Set(snapshot.team.map((member) => member.id));
    const linked = teamMemberId ? snapshot.team.find((member) => member.id === teamMemberId) : undefined;
    if (linked) {
      if (linked.role === invitation.role && linked.active) return ok({ snapshot, events: [], notices: [] });
      return upsertTeamMember(
        snapshot,
        { id: linked.id, name: linked.name, role: invitation.role, title: linked.title, active: true },
        ctx,
      );
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
