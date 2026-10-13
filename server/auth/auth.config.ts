import { getAuth } from "./auth";

/**
 * Entry point for the Better Auth CLI only (`npx auth generate`), which has to
 * evaluate a configuration eagerly.
 *
 * Application code uses `getAuth()` instead, so that a production build does
 * not require a reachable database at module-load time. Nothing imports this.
 */
export const auth = getAuth();
