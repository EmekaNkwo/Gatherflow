import { err, ok, type Result } from "@/lib/result";

/**
 * Web Push settings.
 *
 * The VAPID key pair identifies this deployment to the browsers' push
 * services; generate one with `npx web-push generate-vapid-keys`. Without it
 * reminders stay in the dashboard, and the interface says so rather than
 * offering a switch that does nothing.
 */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** How a push service can reach the operator: `mailto:` or `https:`. */
  subject: string;
}

export function readPushConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Result<PushConfig> {
  const values = {
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) return err(`Reminders are not configured. Missing: ${missing.join(", ")}.`, "not_configured");

  const subject = values.VAPID_SUBJECT as string;
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    return err("Reminders are not configured. VAPID_SUBJECT must start with mailto: or https://.", "not_configured");
  }
  return ok({ publicKey: values.VAPID_PUBLIC_KEY as string, privateKey: values.VAPID_PRIVATE_KEY as string, subject });
}

/**
 * The push services browsers actually use. A subscription's endpoint comes
 * from the browser, and the server later sends a request to it, so it is
 * held to these hosts: anything else would let a caller point the reminder
 * run at an address of their choosing.
 */
const PUSH_SERVICE_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
] as const;

export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
