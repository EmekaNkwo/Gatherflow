import { z } from "zod";
import { getAuth } from "@/server/auth/auth";
import { refusalMessage, signedInAccount } from "@/server/auth/account-request";
import { parseCommandInput } from "@/server/church/input";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Deletes the signed-in account.
 *
 * Refused while the account is the only administrator of a church. Otherwise
 * the sign-in, its sessions and its memberships go; the team members it acted
 * as stay, inactive, so each church's records keep their attribution. See
 * `server/auth/account.ts`.
 */
const schema = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request): Promise<Response> {
  const account = await signedInAccount();
  if (!account.ok) return respondErr(account.error, account.code);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(schema, raw);
  if (!input.ok) return respondErr(input.error, input.code);

  try {
    await getAuth().api.deleteUser({ body: { password: input.value.password }, headers: account.headers });
  } catch (error: unknown) {
    return respondErr(refusalMessage(error, "The account could not be deleted right now."), "refused");
  }
  return respondOk({ deleted: true });
}
