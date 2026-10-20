import { headers } from "next/headers";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { getAuth } from "@/server/auth/auth";
import { churchCookie, createChurchForUser, listMemberships } from "@/server/auth/churches";
import { parseCommandInput } from "@/server/church/input";
import { getDatabase } from "@/server/db/client";
import { respondErr, respondOk } from "@/server/http/respond";

const createSchema = z.object({ name: z.string().trim().min(2).max(120) });

/**
 * Creates a church, with the signed-in account as its administrator. The
 * only way a church comes into being: there is no seed, no sample data, and
 * nobody can be added to it except by invitation.
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
  const input = parseCommandInput(createSchema, raw);
  if (!input.ok) return respondErr(input.error, input.code);

  const db = getDatabase();
  const created = await createChurchForUser(db, {
    userId: authSession.user.id,
    userName: authSession.user.name ?? "",
    churchName: input.value.name,
  });
  await recordAudit(db, {
    churchId: created.churchId,
    userId: authSession.user.id,
    actorId: created.teamMemberId,
    action: "church.create",
    outcome: "ok",
  });

  const secure =
    (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) ===
    "https";
  return Response.json(
    { ok: true, data: { churchId: created.churchId, name: input.value.name } },
    { status: 201, headers: { "set-cookie": churchCookie(created.churchId, secure) } },
  );
}

/** The churches this account belongs to. Needs a session, not a church. */
export async function GET(): Promise<Response> {
  const authSession = await getAuth().api.getSession({ headers: await headers() });
  if (!authSession?.user?.id) return respondErr("You are not signed in.", "unauthenticated");

  const memberships = await listMemberships(getDatabase(), authSession.user.id);
  return respondOk({
    churches: memberships.map((entry) => ({
      churchId: entry.churchId,
      name: entry.churchName,
      role: entry.role,
    })),
  });
}
