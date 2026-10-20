import { z } from "zod";
import { getAuth } from "@/server/auth/auth";
import { refusalMessage, signedInAccount } from "@/server/auth/account-request";
import { parseCommandInput } from "@/server/church/input";
import { readMailjetConfig } from "@/server/email/mailjet";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Changes the signed-in account's email address.
 *
 * Nothing changes on this request: the new address is sent a link, and the
 * account moves to it once that link is opened (an address already confirmed
 * has to approve the move first). The old address is told either way. The
 * password is asked for so a session left open on a shared computer cannot
 * be used to take the account.
 */
const schema = z.object({
  newEmail: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

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
  if (input.value.newEmail === account.email.toLowerCase()) {
    return respondErr("That is already your address.", "invalid_input");
  }

  // Better Auth sends the confirmation in the background and only logs a
  // failure, so a deployment that cannot send at all is refused here rather
  // than telling the person to wait for a link that will never come.
  if (!readMailjetConfig().ok) {
    return respondErr(
      "This deployment cannot send email yet, so the new address could not be confirmed. Ask your administrator.",
      "not_configured",
    );
  }

  const auth = getAuth();
  try {
    await auth.api.verifyPassword({ body: { password: input.value.password }, headers: account.headers });
  } catch {
    return respondErr("That password is not correct.", "forbidden");
  }

  try {
    await auth.api.changeEmail({
      body: { newEmail: input.value.newEmail, callbackURL: "/account?account=email-confirmed" },
      headers: account.headers,
    });
  } catch (error: unknown) {
    return respondErr(refusalMessage(error, "The address could not be changed right now."), "transport");
  }
  // The same answer whether or not the address belongs to another account,
  // so this cannot be used to find out who has one.
  return respondOk({ pending: true, newEmail: input.value.newEmail });
}
