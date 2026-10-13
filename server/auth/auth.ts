import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";

/**
 * Authentication.
 *
 * Better Auth owns identity — who signed in, and that their session is valid.
 * It deliberately does not own authorisation: what a signed-in person may do
 * is a property of their membership of a church, resolved in `session.ts` and
 * enforced in `authorize.ts`.
 *
 * Built lazily because the configuration needs a database connection, and a
 * production build must not require one to be reachable.
 */
function build() {
  return betterAuth({
    database: drizzleAdapter(getDatabase(), {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Required so sign-in from a Server Action can set its cookie.
    plugins: [nextCookies()],
  });
}

/**
 * `betterAuth` returns a type generic over the options it was given, so the
 * instance type is inferred from `build` rather than annotated — annotating it
 * as the general `Auth` widens the options and loses the adapter's type.
 */
export type ChurchAuth = ReturnType<typeof build>;

let instance: ChurchAuth | undefined;

export function getAuth(): ChurchAuth {
  instance ??= build();
  return instance;
}
