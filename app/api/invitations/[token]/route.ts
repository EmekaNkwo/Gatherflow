import { findOpenInvitation } from "@/server/auth/invitations";
import { getDatabase } from "@/server/db/client";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * What an invitation link is for, before the person signs in. Public, because
 * the person may not have an account yet; it reveals only what the link's
 * holder was already told — which church, which role, which address.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const open = await findOpenInvitation(getDatabase(), token);
  if (!open.ok) return respondErr(open.error, open.code);
  return respondOk({
    churchName: open.value.churchName,
    role: open.value.role,
    email: open.value.email,
    expiresAt: open.value.expiresAt.toISOString(),
  });
}
