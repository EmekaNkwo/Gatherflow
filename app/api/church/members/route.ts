import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ok } from "@/lib/result";
import { upsertTeamMember } from "@/services/settings/settings";
import { auditResult, recordAudit } from "@/server/audit/audit";
import { guardedSession } from "@/server/auth/admin-session";
import { parseCommandInput } from "@/server/church/input";
import { runSystemCommand } from "@/server/church/commands";
import { churchMembers, user } from "@/server/db/schema";
import { respondErr, respondOk } from "@/server/http/respond";
import { DEMO_ROLES } from "@/types/team";

/**
 * The accounts that can sign in to this church, for an administrator.
 *
 * A membership's role is the one the server enforces. Changing it here also
 * changes the role on the team member the account acts as, so the two never
 * disagree. An administrator cannot remove or demote themselves: a church
 * must always have somebody who can let people in.
 */

export async function GET(): Promise<Response> {
  const context = await guardedSession("settings.write");
  if (!context.ok) return respondErr(context.error, context.code);
  const { db, session } = context;

  const rows = await db
    .select({
      userId: churchMembers.userId,
      email: user.email,
      name: user.name,
      role: churchMembers.role,
      teamMemberId: churchMembers.teamMemberId,
      since: churchMembers.createdAt,
    })
    .from(churchMembers)
    .innerJoin(user, eq(user.id, churchMembers.userId))
    .where(eq(churchMembers.churchId, session.churchId))
    .orderBy(user.name);

  return respondOk({
    members: rows.map((row) => ({ ...row, since: row.since.toISOString(), self: row.userId === session.userId })),
  });
}

const patchSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(DEMO_ROLES as unknown as [string, ...string[]]),
});

export async function PATCH(request: Request): Promise<Response> {
  const context = await guardedSession("settings.write");
  if (!context.ok) return respondErr(context.error, context.code);
  const { db, session } = context;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(patchSchema, raw);
  if (!input.ok) return respondErr(input.error, input.code);
  const role = input.value.role as (typeof DEMO_ROLES)[number];

  if (input.value.userId === session.userId && role !== "administrator") {
    return respondErr("You cannot change your own role. Ask another administrator.", "forbidden");
  }

  const [target] = await db
    .select({ teamMemberId: churchMembers.teamMemberId })
    .from(churchMembers)
    .where(and(eq(churchMembers.churchId, session.churchId), eq(churchMembers.userId, input.value.userId)));
  if (!target) return respondErr("That account does not belong to this church.", "not_found");

  await db
    .update(churchMembers)
    .set({ role })
    .where(and(eq(churchMembers.churchId, session.churchId), eq(churchMembers.userId, input.value.userId)));

  // Keep the team member's role in step, so what the interface shows about
  // a person and what the server lets their account do cannot differ.
  const synced = await runSystemCommand(db, session.churchId, (snapshot, ctx) => {
    const member = target.teamMemberId
      ? snapshot.team.find((entry) => entry.id === target.teamMemberId)
      : undefined;
    if (!member) return ok({ snapshot, events: [], notices: [] });
    return upsertTeamMember(snapshot, { id: member.id, name: member.name, role, title: member.title, active: member.active }, ctx);
  });

  await auditResult(
    db,
    {
      churchId: session.churchId,
      userId: session.userId,
      actorId: session.teamMemberId,
      action: "membership.role",
      targetId: target.teamMemberId ?? input.value.userId,
    },
    synced,
  );
  if (!synced.ok) return respondErr(synced.error, synced.code);
  return respondOk({ userId: input.value.userId, role });
}

export async function DELETE(request: Request): Promise<Response> {
  const context = await guardedSession("settings.write");
  if (!context.ok) return respondErr(context.error, context.code);
  const { db, session } = context;

  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return respondErr("Say which account: ?userId=<id>.", "invalid_input");
  if (userId === session.userId) {
    return respondErr("You cannot remove yourself. Ask another administrator.", "forbidden");
  }

  const removed = await db
    .delete(churchMembers)
    .where(and(eq(churchMembers.churchId, session.churchId), eq(churchMembers.userId, userId)))
    .returning({ teamMemberId: churchMembers.teamMemberId });

  await recordAudit(db, {
    churchId: session.churchId,
    userId: session.userId,
    actorId: session.teamMemberId,
    action: "membership.remove",
    targetId: removed[0]?.teamMemberId ?? userId,
    outcome: removed.length ? "ok" : "refused",
    code: removed.length ? null : "not_found",
  });
  if (!removed.length) return respondErr("That account does not belong to this church.", "not_found");

  // The team member stays, inactive, so their history keeps its attribution.
  if (removed[0].teamMemberId) {
    const teamMemberId = removed[0].teamMemberId;
    await runSystemCommand(db, session.churchId, (snapshot, ctx) => {
      const member = snapshot.team.find((entry) => entry.id === teamMemberId);
      if (!member) return ok({ snapshot, events: [], notices: [] });
      return upsertTeamMember(snapshot, { id: member.id, name: member.name, role: member.role, title: member.title, active: false }, ctx);
    });
  }
  return respondOk({ removed: true });
}
