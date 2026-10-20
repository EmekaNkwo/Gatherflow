import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { leaveChurches, retireAccount } from "./account";
import {
  addressChangeNoticeEmail,
  approveAddressChangeEmail,
  verifyNewAddressEmail,
} from "./account-emails";
import { sendSystemEmail } from "@/server/email/transactional";
import { consumeBudget } from "@/server/http/rate-limit";

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
      minPasswordLength: 12,
      // The reset link goes out as transactional mail. If the deployment
      // cannot send, the request page says so; the account is unaffected.
      sendResetPassword: async ({ user, url }) => {
        const sent = await sendSystemEmail({
          to: user.email,
          subject: "Reset your GatherFlow password",
          text:
            `Hello ${user.name || ""}

` +
            "Somebody asked to reset the password for this GatherFlow account. " +
            `If that was you, open this link within the next hour:

${url}

` +
            "If it was not you, ignore this message; nothing has changed.",
        });
        if (!sent.ok) throw new Error(sent.error);
      },
      resetPasswordTokenExpiresIn: 60 * 60,
    },
    // Used for one thing: confirming a new address when an account changes
    // its email. Sign-up does not send it — a church's volunteers are
    // invited by address, which is the proof that matters there.
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        const [stored] = await getDatabase()
          .select({ email: schema.user.email })
          .from(schema.user)
          .where(eq(schema.user.id, user.id));
        const sent = await sendSystemEmail(verifyNewAddressEmail(user.email, url));
        if (!sent.ok) throw new APIError("BAD_REQUEST", { message: sent.error });
        // The address is being changed: tell the one it is changing from.
        if (stored && stored.email !== user.email) {
          const notice = await sendSystemEmail(addressChangeNoticeEmail(stored.email, user.email));
          if (!notice.ok) {
            console.error(
              JSON.stringify({ at: new Date().toISOString(), event: "account.email_notice.failed", userId: user.id }),
            );
          }
        }
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        // Once an address has been confirmed, moving away from it needs that
        // address's approval first, then the new one's confirmation.
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          const sent = await sendSystemEmail(approveAddressChangeEmail(user.email, newEmail, url));
          if (!sent.ok) throw new APIError("BAD_REQUEST", { message: sent.error });
        },
      },
      deleteUser: {
        enabled: true,
        // A church must keep an administrator; past that, the account's team
        // members are retired so the church's history keeps its names.
        beforeDelete: async (user) => {
          const db = getDatabase();
          const left = await leaveChurches(db, user.id);
          if (!left.ok) throw new APIError("BAD_REQUEST", { message: left.error });
          await retireAccount(db, user.id, left.value);
        },
      },
    },
    // Changing the address and deleting the account are reached only through
    // `/api/account`, which asks for the password and spends from the shared
    // request budget first. Nothing in the application asks for a verification
    // email on its own, so the endpoint that would send one to any address on
    // request is closed too.
    disabledPaths: ["/change-email", "/delete-user", "/send-verification-email"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/delete-user" && !ctx.body?.password) {
          throw new APIError("BAD_REQUEST", { message: "Enter your password to delete your account." });
        }
      }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Credential endpoints are the ones worth guessing at. Five tries per ten
    // seconds per address is generous for a person and hopeless for a script;
    // the test suite raises it because it signs in dozens of times a minute.
    rateLimit: {
      // On in every environment (Better Auth's default is production only),
      // so the limits can be seen and tested locally too. Set
      // AUTH_RATE_LIMIT_ENABLED=false to switch them off.
      enabled: process.env.AUTH_RATE_LIMIT_ENABLED !== "false",
      // Counted in Postgres, so a deployment running several instances has
      // one budget per address rather than one per instance.
      customStorage: {
        consume: (key, rule) => consumeBudget(getDatabase(), `auth:${key}`, rule),
      },
      customRules: {
        "/sign-in/email": { window: 10, max: signInBudget() },
        "/sign-up/email": { window: 10, max: signInBudget() },
        "/request-password-reset": { window: 60, max: signInBudget() },
      },
    },
    // Required so sign-in from a Server Action can set its cookie.
    plugins: [nextCookies()],
    // In development, the same machine reached as 127.0.0.1 rather than
    // localhost is the same origin to a person, but not to the browser.
    trustedOrigins: developmentAliases(),
  });
}

function developmentAliases(): string[] {
  const base = process.env.BETTER_AUTH_URL;
  if (process.env.NODE_ENV !== "development" || !base?.includes("://localhost")) return [];
  return [base.replace("://localhost", "://127.0.0.1")];
}

function signInBudget(): number {
  const configured = Number(process.env.AUTH_RATE_LIMIT_MAX);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
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
