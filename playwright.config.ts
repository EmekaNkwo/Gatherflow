import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * The production build runs against a real Postgres, a real Better Auth
 * session and a stub standing in for Mailjet's Send API, so the suites walk
 * the real paths over HTTP: sign up, create a church, invite, register a
 * visitor, follow up, queue an email, drain the outbox, receive the
 * provider's events, unsubscribe.
 *
 * Needs `DATABASE_URL` (a throwaway database: the suite creates and deletes
 * churches and accounts) and `BETTER_AUTH_SECRET`, both from `.env.local`.
 * Everything else is set here.
 */
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

/**
 * The suite creates and deletes churches and accounts, so it only ever runs
 * against the throwaway test database — never the one the app is pointed at.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is not set; the remote suite needs a throwaway database.");
}
const host = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.env.REMOTE_E2E_ALLOW_REMOTE_DB) {
  throw new Error(
    `TEST_DATABASE_URL points at ${host}; refusing to run a destructive suite against it. Set REMOTE_E2E_ALLOW_REMOTE_DB=1 to override.`,
  );
}

const PORT = Number(process.env.REMOTE_E2E_PORT ?? 3211);
const STUB_PORT = Number(process.env.STUB_MAILJET_PORT ?? 3611);
const baseURL = `http://localhost:${PORT}`;

/** Shared with the spec through the environment, so neither hard-codes them. */
export const REMOTE_E2E = {
  baseURL,
  stubURL: `http://localhost:${STUB_PORT}`,
  cronSecret: "e2e-cron-secret",
  webhookSecret: "e2e-webhook-secret",
  fromEmail: "hello@gatherflow.test",
} as const;

const serverEnv: Record<string, string> = {
  DATABASE_URL: databaseUrl,
  EMAIL_SENDING_ENABLED: "true",
  // The suites sign in far more often than a person would.
  AUTH_RATE_LIMIT_MAX: "200",
  MAILJET_API_KEY: "e2e-key",
  MAILJET_SECRET_KEY: "e2e-secret",
  MAILJET_FROM_EMAIL: REMOTE_E2E.fromEmail,
  MAILJET_FROM_NAME: "GatherFlow E2E",
  MAILJET_WEBHOOK_SECRET: REMOTE_E2E.webhookSecret,
  MAILJET_SEND_URL: `${REMOTE_E2E.stubURL}/v3.1/send`,
  CRON_SECRET: REMOTE_E2E.cronSecret,
  BETTER_AUTH_URL: baseURL,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // One worker: the tests share a database and a stub provider, and the
  // provider's record of what was sent is what the assertions read.
  workers: 1,
  webServer: [
    {
      command: "node e2e/stub-mailjet.mjs",
      url: `${REMOTE_E2E.stubURL}/healthz`,
      reuseExistingServer: !process.env.CI,
      env: { STUB_MAILJET_PORT: String(STUB_PORT) },
      timeout: 30_000,
    },
    {
      command: `npx next build && npx next start --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      env: serverEnv,
      timeout: 420_000,
    },
  ],
});
