import { toast } from "sonner";
import { FORM_ERROR_TOAST } from "./form-toast";

/**
 * When the server says "too many attempts". Better Auth answers 429 with
 * `X-Retry-After`; GatherFlow's own routes use the standard `Retry-After`.
 * Either way the page says how long to wait and counts down (`useCooldown`),
 * instead of leaving the person pressing a button that keeps failing.
 */
export const DEFAULT_RETRY_SECONDS = 30;

export function retryAfterSeconds(headers: Headers | undefined, fallback = DEFAULT_RETRY_SECONDS): number {
  const raw = headers?.get("Retry-After") ?? headers?.get("X-Retry-After");
  const seconds = Number(raw);
  return raw && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : fallback;
}

export function rateLimitedMessage(seconds: number): string {
  const wait =
    seconds <= 1 ? "a second" : seconds < 90 ? `${seconds} seconds` : `about ${Math.round(seconds / 60)} minutes`;
  return `For your security, please wait ${wait} and try again.`;
}

/** For a button: "Try again in 9s", or "in 10 min" for a long wait. */
export function tryAgainIn(seconds: number): string {
  return seconds < 90 ? `Try again in ${seconds}s` : `Try again in ${Math.ceil(seconds / 60)} min`;
}

export function notifyRateLimited(seconds: number): void {
  // The wait replaces any "that didn't work" still on screen.
  toast.dismiss(FORM_ERROR_TOAST);
  toast.error("Too many attempts", { id: "rate-limited", description: rateLimitedMessage(seconds) });
}

/**
 * Fetch options for a Better Auth client call that remember how long a 429
 * said to wait: `authClient.signIn.email({ ...body, fetchOptions })`, then
 * `seconds()` after the call returns an error with status 429.
 */
export function retryAfterCapture() {
  let seconds: number | undefined;
  return {
    fetchOptions: {
      onError: (context: { response: Response }) => {
        if (context.response.status === 429) seconds = retryAfterSeconds(context.response.headers);
      },
    },
    seconds: () => seconds,
  };
}
