import { err, ok, type Result } from "@/lib/result";
import type { EmailAvailability } from "@/types/email";

/**
 * Mailjet Send API v3.1.
 *
 * `POST https://api.mailjet.com/v3.1/send`, Basic auth with the public key as
 * the username and the private key as the password. The response reports one
 * entry per recipient carrying `MessageID` and `MessageUUID`, both of which are
 * stored so a later webhook can be matched even if `CustomID` is absent.
 *
 * The transport is injected so tests exercise this code without a network, and
 * so a send can be driven from a fixture rather than from the real account.
 * The URL is configurable for the same reason: the remote end-to-end suite
 * points it at a stub that records what would have been sent.
 */

export const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";

export interface MailjetCredentials {
  apiKey: string;
  secretKey: string;
  fromEmail: string;
  fromName: string;
  /** Defaults to the real API. Overridden only to send to a stub. */
  sendUrl?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  htmlPart: string;
  textPart: string;
  /** Echoed back on every webhook event for this message. */
  customId: string;
  /**
   * Where a recipient goes to stop hearing from this church. Absent for
   * transactional mail the person asked for (a password reset), which
   * carries no unsubscribe because there is nothing to unsubscribe from.
   */
  unsubscribeUrl?: string;
}

export interface SendAccepted {
  messageId: string | null;
  messageUuid: string | null;
}

/** Anything that can perform the HTTP call. `fetch`, or a fixture. */
export type MailjetTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface MailjetClient {
  send(email: OutgoingEmail): Promise<Result<SendAccepted>>;
}

/**
 * Whether a failure is worth trying again.
 *
 * 4xx other than 429 means the request itself is wrong — the same request will
 * be wrong next time, so retrying only burns the schedule and delays the
 * failure being visible.
 */
export function isRetryable(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 || status === 408;
}

export function createMailjetClient(
  credentials: MailjetCredentials,
  transport: MailjetTransport = defaultTransport,
): MailjetClient {
  const authorization = `Basic ${Buffer.from(
    `${credentials.apiKey}:${credentials.secretKey}`,
  ).toString("base64")}`;
  const sendUrl = credentials.sendUrl ?? MAILJET_SEND_URL;

  return {
    async send(email) {
      const payload = {
        Messages: [
          {
            From: { Email: credentials.fromEmail, Name: credentials.fromName },
            To: [{ Email: email.to }],
            Subject: email.subject,
            TextPart: email.textPart,
            HTMLPart: email.htmlPart,
            CustomID: email.customId,
            ...(email.unsubscribeUrl
              ? {
                  Headers: {
                    // Required for bulk mail, and the honest counterpart to
                    // the opt-in consent the church recorded in the first place.
                    "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                  },
                }
              : {}),
          },
        ],
      };

      let response: { status: number; json: () => Promise<unknown> };
      try {
        response = await transport(sendUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization,
          },
          body: JSON.stringify(payload),
        });
      } catch (error: unknown) {
        // A transport failure is always worth another attempt: nothing is
        // known about whether the message was accepted.
        const message = error instanceof Error ? error.message : "unknown transport error";
        return err(`Could not reach Mailjet: ${message}`, "retry");
      }

      if (response.status >= 300) {
        const detail = await safeText(response);
        return err(
          `Mailjet responded ${response.status}: ${detail}`,
          isRetryable(response.status) ? "retry" : "permanent",
        );
      }

      const body = (await response.json()) as MailjetSendResponse | null;
      const first = body?.Messages?.[0];

      if (!first || first.Status !== "success") {
        // A 200 with a per-message failure is Mailjet rejecting this specific
        // message — the address, usually. Repeating it will not help.
        return err(
          `Mailjet rejected the message: ${first?.Errors?.[0]?.ErrorMessage ?? "no reason given"}`,
          "permanent",
        );
      }

      const recipient = first.To?.[0];
      return ok({
        messageId: recipient?.MessageID != null ? String(recipient.MessageID) : null,
        messageUuid: recipient?.MessageUUID ?? null,
      });
    },
  };
}

interface MailjetSendResponse {
  Messages?: Array<{
    Status?: string;
    Errors?: Array<{ ErrorMessage?: string }>;
    To?: Array<{ Email?: string; MessageID?: number | string; MessageUUID?: string }>;
  }>;
}

async function safeText(response: {
  json: () => Promise<unknown>;
}): Promise<string> {
  try {
    return JSON.stringify(await response.json()).slice(0, 500);
  } catch {
    return "unreadable body";
  }
}

const defaultTransport: MailjetTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, json: () => response.json() as Promise<unknown> };
};

export interface MailjetConfig extends MailjetCredentials {
  /** Shared secret in the webhook path. */
  webhookSecret: string;
  /** Base URL used to build the unsubscribe link. */
  appUrl: string;
  /** False when `appUrl` is the development default rather than a set value. */
  appUrlConfigured: boolean;
  /** Signs unsubscribe links so a guessed person id cannot opt somebody out. */
  unsubscribeSecret: string;
  /**
   * The production gate. Credentials make sending *possible*; this makes it
   * *offered*. It stays off until the hardening checklist has passed, so a
   * configured-but-unverified deployment still behaves as the demo does.
   */
  sendingEnabled: boolean;
  /**
   * Addresses a controlled pilot may write to. Empty means no restriction.
   * While set, a send to any other address is refused before it is queued.
   */
  pilotAllowlist: readonly string[];
}

export const NOT_CONFIGURED = "not_configured";
export const NOT_ENABLED = "not_enabled";

/**
 * Reads the configuration, or explains exactly what is missing.
 *
 * Returned as a refusal rather than thrown: the application runs perfectly
 * well with no email configured — it simply does not offer to send.
 */
export function readMailjetConfig(
  env: NodeJS.ProcessEnv = process.env,
): Result<MailjetConfig> {
  const missing: string[] = [];
  const required = {
    apiKey: env.MAILJET_API_KEY,
    secretKey: env.MAILJET_SECRET_KEY,
    fromEmail: env.MAILJET_FROM_EMAIL,
    webhookSecret: env.MAILJET_WEBHOOK_SECRET,
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value) missing.push(key);
  }
  if (missing.length) {
    return err(`Email is not configured. Missing: ${missing.join(", ")}.`, NOT_CONFIGURED);
  }

  // Set but empty is a mistake, not "no pilot": fail closed rather than
  // quietly lifting a restriction the operator believes is in force.
  const pilotAllowlist = parseAllowlist(env.EMAIL_PILOT_ALLOWLIST);
  if (env.EMAIL_PILOT_ALLOWLIST !== undefined && env.EMAIL_PILOT_ALLOWLIST.trim() !== "" && pilotAllowlist.length === 0) {
    return err(
      "Email is not configured. EMAIL_PILOT_ALLOWLIST is set but contains no addresses.",
      NOT_CONFIGURED,
    );
  }

  const unsubscribeSecret = env.UNSUBSCRIBE_SECRET ?? env.BETTER_AUTH_SECRET;
  if (!unsubscribeSecret) {
    return err(
      "Email is not configured. Missing: UNSUBSCRIBE_SECRET (or BETTER_AUTH_SECRET).",
      NOT_CONFIGURED,
    );
  }

  return ok({
    apiKey: required.apiKey as string,
    secretKey: required.secretKey as string,
    fromEmail: required.fromEmail as string,
    fromName: env.MAILJET_FROM_NAME ?? "GatherFlow",
    sendUrl: env.MAILJET_SEND_URL || undefined,
    webhookSecret: required.webhookSecret as string,
    appUrl: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    appUrlConfigured: Boolean(env.BETTER_AUTH_URL),
    unsubscribeSecret,
    sendingEnabled: isTruthy(env.EMAIL_SENDING_ENABLED),
    pilotAllowlist,
  });
}

export type { EmailAvailability };

/**
 * Reasons here are deliberately generic: this goes to every signed-in
 * browser, and the names of missing variables belong in the server's own
 * configuration refusal, not in a response.
 */
export function emailAvailability(env: NodeJS.ProcessEnv = process.env): EmailAvailability {
  const config = readMailjetConfig(env);
  if (!config.ok) {
    return {
      configured: false,
      enabled: false,
      pilot: false,
      reason: "Email is not configured for this deployment.",
    };
  }
  const gate = assertSendingEnabled(config.value);
  if (!gate.ok) {
    return {
      configured: true,
      enabled: false,
      pilot: false,
      reason: "Email is configured but sending is not switched on for this deployment.",
    };
  }
  return { configured: true, enabled: true, pilot: config.value.pilotAllowlist.length > 0 };
}

/** The gate, as a refusal the send endpoint returns. */
export function assertSendingEnabled(config: MailjetConfig): Result<MailjetConfig> {
  if (!config.sendingEnabled) {
    return err(
      "Email sending is not switched on for this deployment. Draft, copy or open the message in another app instead.",
      NOT_ENABLED,
    );
  }
  // Every message carries an unsubscribe link built from this origin. Sending
  // with the development default would put localhost links in people's inboxes.
  if (!config.appUrlConfigured) {
    return err(
      "Email sending is switched on but BETTER_AUTH_URL is not set, so unsubscribe links would be wrong. Nothing was sent.",
      NOT_ENABLED,
    );
  }
  return ok(config);
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function parseAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
