import { headers } from "next/headers";
import { auditResult } from "@/server/audit/audit";
import { getAuth } from "@/server/auth/auth";
import { churchCookie } from "@/server/auth/churches";
import { acceptInvitation, findOpenInvitation } from "@/server/auth/invitations";
import { getDatabase } from "@/server/db/client";
import { respondErr } from "@/server/http/respond";

/** Joins the church. Needs a session whose address matches the invitation. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const authSession = await getAuth().api.getSession({ headers: await headers() });
  if (!authSession?.user?.id) return respondErr("Sign in or create an account first.", "unauthenticated");

  const { token } = await params;
  const db = getDatabase();
  const open = await findOpenInvitation(db, token);
  if (!open.ok) return respondErr(open.error, open.code);

  const accepted = await acceptInvitation(db, token, {
    userId: authSession.user.id,
    email: authSession.user.email,
    name: authSession.user.name ?? "",
  });
  await auditResult(
    db,
    {
      churchId: open.value.churchId,
      userId: authSession.user.id,
      actorId: accepted.ok ? accepted.value.teamMemberId : null,
      action: "invitation.accept",
    },
    accepted,
  );
  if (!accepted.ok) return respondErr(accepted.error, accepted.code);

  const secure =
    (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) ===
    "https";
  return Response.json(
    { ok: true, data: accepted.value },
    { status: 200, headers: { "set-cookie": churchCookie(accepted.value.churchId, secure) } },
  );
}
