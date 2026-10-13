import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

/**
 * Better Auth's endpoints.
 *
 * The handler is built per request rather than at module scope, because the
 * auth instance needs a database connection and a production build must not
 * require one to be reachable.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
