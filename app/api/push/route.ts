import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/server/auth/auth";
import { parseCommandInput } from "@/server/church/input";
import { getDatabase } from "@/server/db/client";
import { respondErr, respondOk } from "@/server/http/respond";
import { isPushEndpoint, readPushConfig } from "@/server/push/config";
import { hasSubscription, removeSubscription, saveSubscription } from "@/server/push/subscriptions";

/**
 * This browser's daily reminder.
 *
 *   GET     whether reminders can be turned on, and the key to subscribe with
 *   POST    turn them on for this browser
 *   DELETE  turn them off (?endpoint=<the browser's endpoint>)
 *
 * About the account, not a church, so any signed-in person may use it.
 */
/** A base64url string that decodes to exactly `bytes` bytes. */
function keyOf(bytes: number) {
  return z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "That is not a browser key.")
    .refine((value) => Buffer.from(value, "base64url").length === bytes, "That is not a browser key.");
}

// The keys are checked here, so a browser that sent malformed ones is told
// now rather than failing quietly in every reminder run.
const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, "That is not a browser push service."),
  keys: z.object({ p256dh: keyOf(65), auth: keyOf(16) }),
});

async function signedInUserId(): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const userId = await signedInUserId();
  if (!userId) return respondErr("You are not signed in.", "unauthenticated");
  const config = readPushConfig();
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  return respondOk({
    available: config.ok,
    publicKey: config.ok ? config.value.publicKey : null,
    subscribed: endpoint ? await hasSubscription(getDatabase(), userId, endpoint) : false,
  });
}

export async function POST(request: Request): Promise<Response> {
  const userId = await signedInUserId();
  if (!userId) return respondErr("You are not signed in.", "unauthenticated");
  if (!readPushConfig().ok) return respondErr("Reminders are not set up on this deployment.", "not_configured");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(subscriptionSchema, raw);
  if (!input.ok) return respondErr(input.error, input.code);

  await saveSubscription(getDatabase(), userId, input.value);
  return respondOk({ subscribed: true }, 201);
}

export async function DELETE(request: Request): Promise<Response> {
  const userId = await signedInUserId();
  if (!userId) return respondErr("You are not signed in.", "unauthenticated");
  const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
  if (!endpoint) return respondErr("Say which browser: ?endpoint=<endpoint>.", "invalid_input");
  await removeSubscription(getDatabase(), userId, endpoint);
  return respondOk({ subscribed: false });
}
