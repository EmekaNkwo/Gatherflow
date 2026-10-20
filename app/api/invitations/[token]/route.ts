import { findOpenInvitation } from "@/server/auth/invitations";
import { getDatabase } from "@/server/db/client";
import { clientAddress } from "@/server/http/client-address";
import { consumeBudget } from "@/server/http/rate-limit";
import { respondErr, respondOk, respondRateLimited } from "@/server/http/respond";

/**
 * Thirty lookups per ten minutes from one address: plenty for a person
 * opening their link a few times, and nothing like enough to guess tokens.
 * Counted in Postgres, so the budget holds across instances.
 */
const LOOKUP_BUDGET = { window: 10 * 60, max: 30 };

/**
 * What an invitation link is for, before the person signs in. Public, because
 * the person may not have an account yet; it reveals only what the link's
 * holder was already told — which church, which role, which address.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const db = getDatabase();
  const budget = await consumeBudget(db, `invite-lookup:${clientAddress(request)}`, LOOKUP_BUDGET);
  if (!budget.allowed) {
    return respondRateLimited(budget.retryAfter ?? LOOKUP_BUDGET.window, "Too many tries from this connection.");
  }

  const { token } = await params;
  const open = await findOpenInvitation(db, token);
  if (!open.ok) return respondErr(open.error, open.code);
  return respondOk({
    churchName: open.value.churchName,
    role: open.value.role,
    email: open.value.email,
    expiresAt: open.value.expiresAt.toISOString(),
  });
}
