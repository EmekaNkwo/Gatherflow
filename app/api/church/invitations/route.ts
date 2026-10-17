import { eq } from "drizzle-orm";
import { z } from "zod";
import { auditResult, recordAudit } from "@/server/audit/audit";
import {
  createInvitation,
  invitationUrl,
  listInvitations,
  revokeInvitation,
} from "@/server/auth/invitations";
import { guardedSession } from "@/server/auth/admin-session";
import { sendInvitationEmail } from "@/server/auth/invitation-email";
import { churches, user } from "@/server/db/schema";
import { parseCommandInput } from "@/server/church/input";
import { respondErr, respondOk } from "@/server/http/respond";
import { DEMO_ROLES } from "@/types/team";

/**
 * Invitations to this church's team. Administrators only.
 *
 * Creating one emails the link to the person and also returns it once; it
 * is not stored and cannot be shown again. When the deployment cannot send
 * mail, or the send fails, the response says so and the administrator passes
 * the link on themselves. Either way it works for seven days.
 */
const createSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(DEMO_ROLES as unknown as [string, ...string[]]),
  teamMemberId: z.string().min(1).max(200).optional(),
});


export async function GET(): Promise<Response> {
  const context = await guardedSession("settings.write");
  if (!context.ok) return respondErr(context.error, context.code);
  return respondOk({ invitations: await listInvitations(context.db, context.session.churchId) });
}

export async function POST(request: Request): Promise<Response> {
  const context = await guardedSession("settings.write");
  if (!context.ok) return respondErr(context.error, context.code);
  const { db, session } = context;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(createSchema, raw);
  if (!input.ok) return respondErr(input.error, input.code);

  const created = await createInvitation(db, {
    churchId: session.churchId,
    email: input.value.email,
    role: input.value.role as (typeof DEMO_ROLES)[number],
    teamMemberId: input.value.teamMemberId ?? null,
    invitedBy: session.userId,
  });
  await auditResult(
    db,
    { churchId: session.churchId, userId: session.userId, actorId: session.teamMemberId, action: "invitation.create" },
    created,
  );
  if (!created.ok) return respondErr(created.error, created.code);

  const appUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  const link = invitationUrl(appUrl, created.value.token);
  const [church] = await db.select({ name: churches.name }).from(churches).where(eq(churches.id, session.churchId));
  const [inviter] = await db.select({ name: user.name }).from(user).where(eq(user.id, session.userId));
  const delivery = await sendInvitationEmail({
    to: created.value.invitation.email,
    churchName: church?.name ?? "your church",
    inviterName: inviter?.name ?? "",
    role: created.value.invitation.role,
    link,
    expiresAt: created.value.invitation.expiresAt,
  });
  await recordAudit(db, {
    churchId: session.churchId,
    userId: session.userId,
    actorId: session.teamMemberId,
    action: "invitation.email",
    targetId: created.value.invitation.id,
    outcome: delivery.emailed ? "ok" : "failed",
  });

  return respondOk({ invitation: created.value.invitation, link, delivery }, 201);
}

export async function DELETE(request: Request): Promise<Response> {
  const context = await guardedSession("settings.write");
  if (!context.ok) return respondErr(context.error, context.code);
  const { db, session } = context;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return respondErr("Say which invitation: ?id=<id>.", "invalid_input");

  const removed = await revokeInvitation(db, session.churchId, id);
  await recordAudit(db, {
    churchId: session.churchId,
    userId: session.userId,
    actorId: session.teamMemberId,
    action: "invitation.revoke",
    outcome: removed ? "ok" : "refused",
    code: removed ? null : "not_found",
  });
  if (!removed) return respondErr("That invitation was not found.", "not_found");
  return respondOk({ removed: true });
}
