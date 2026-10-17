import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { getDatabase, type Database } from "@/server/db/client";
import { consumeBudget } from "@/server/http/rate-limit";
import { getAuth } from "./auth";

/**
 * What the account routes share: a signed-in account (no church needed —
 * these are about the person, not a congregation), a password check that
 * spends from the shared budget, and Better Auth refusals turned into
 * messages a person can act on.
 */
export type AccountRequest =
  | { ok: true; db: Database; headers: Headers; userId: string; email: string }
  | { ok: false; error: string; code: string };

/** Five password attempts per quarter hour, per account, across every instance. */
const PASSWORD_BUDGET = { window: 15 * 60, max: 5 };

export async function signedInAccount(): Promise<AccountRequest> {
  const requestHeaders = await headers();
  const authSession = await getAuth().api.getSession({ headers: requestHeaders });
  if (!authSession?.user?.id) return { ok: false, error: "You are not signed in.", code: "unauthenticated" };

  const db = getDatabase();
  const budget = await consumeBudget(db, `account:${authSession.user.id}`, PASSWORD_BUDGET);
  if (!budget.allowed) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${Math.ceil((budget.retryAfter ?? 60) / 60)} minutes.`,
      code: "rate_limited",
    };
  }
  return { ok: true, db, headers: requestHeaders, userId: authSession.user.id, email: authSession.user.email };
}

export function refusalMessage(error: unknown, fallback: string): string {
  if (isAPIError(error)) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message) return body.message;
  }
  return fallback;
}
