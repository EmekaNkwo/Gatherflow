import type { Result } from "@/lib/result";

/**
 * One response envelope for every endpoint, so the client has a single shape
 * to read and a refusal never arrives looking like a success.
 */
export function respondOk<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

export function respondErr(error: string, code?: string): Response {
  return Response.json({ ok: false, error, code }, { status: statusFor(code) });
}

/**
 * Too many requests: a 429 that says how long to wait, both in `Retry-After`
 * (which browsers and proxies understand) and in the body, so a page can
 * count down rather than leave the person guessing.
 */
export function respondRateLimited(retryAfterSeconds: number, error: string): Response {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return Response.json(
    { ok: false, error, code: "rate_limited", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Turns a domain refusal into the response it deserves. */
export function respond<T>(outcome: Result<T>, status = 200): Response {
  return outcome.ok
    ? respondOk(outcome.value, status)
    : respondErr(outcome.error, outcome.code);
}

/**
 * Refusal codes come from the domain, not from HTTP, so they are mapped here
 * rather than letting every handler invent a status.
 */
function statusFor(code: string | undefined): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "no_membership":
    case "church_required":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "in_progress":
      return 409;
    case "rate_limited":
      return 429;
    case "invalid_input":
    case "unknown_command":
      return 400;
    case "storage_failed":
    case "transport":
      return 503;
    default:
      // A business-rule refusal is a well-formed request the rules declined:
      // 422 says "understood, and not allowed", which is what happened.
      return 422;
  }
}
