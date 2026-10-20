import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for operator endpoints (the cron, the health check).
 *
 * Hashed before comparison so the comparison is constant-time regardless of
 * length, and a 404 rather than a 401 on mismatch so that probing cannot tell
 * a wrong token from a wrong path.
 */
export function bearerMatches(request: Request, expected: string): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
