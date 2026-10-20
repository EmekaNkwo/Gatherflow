/**
 * The address a request came from, for counting requests against a budget.
 *
 * The host's proxy puts the client first in `x-forwarded-for`; `x-real-ip` is
 * the fallback some proxies use. With neither (a bare local server), every
 * request shares one "unknown" bucket — stricter, never looser.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = request.headers.get("x-real-ip")?.trim();
  return real || "unknown";
}
