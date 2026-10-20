import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/server/auth/auth";
import { churchCookie, clearChurchCookie, listMemberships } from "@/server/auth/churches";
import { parseCommandInput } from "@/server/church/input";
import { getDatabase } from "@/server/db/client";
import { respondErr } from "@/server/http/respond";

const schema = z.object({ churchId: z.string().min(1).max(200) });

/** Forgets the choice. Called before sign-out so the next person starts fresh. */
export async function DELETE(): Promise<Response> {
  return Response.json(
    { ok: true, data: null },
    { status: 200, headers: { "set-cookie": clearChurchCookie() } },
  );
}

/**
 * Records which church to open. The cookie is only ever set to a church the
 * account is a member of; anything else is refused without a cookie.
 */
export async function POST(request: Request): Promise<Response> {
  const requestHeaders = await headers();
  const authSession = await getAuth().api.getSession({ headers: requestHeaders });
  if (!authSession?.user?.id) return respondErr("You are not signed in.", "unauthenticated");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(schema, raw);
  if (!input.ok) return respondErr(input.error, input.code);

  const memberships = await listMemberships(getDatabase(), authSession.user.id);
  const chosen = memberships.find((entry) => entry.churchId === input.value.churchId);
  if (!chosen) return respondErr("You do not have access to that church.", "no_membership");

  const secure =
    (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) ===
    "https";
  return Response.json(
    { ok: true, data: { churchId: chosen.churchId, name: chosen.churchName } },
    { status: 200, headers: { "set-cookie": churchCookie(chosen.churchId, secure) } },
  );
}
