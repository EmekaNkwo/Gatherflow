import { err, ok, type Result } from "@/lib/result";

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
 */

export const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";

export interface MailjetCredentials {
  apiKey: string;
  secretKey: string;
  fromEmail: string;
  fromName: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  htmlPart: string;
  textPart: string;
  /** Echoed back on every webhook event for this message. */
  customId: string;
  /** Where a recipient goes to stop hearing from this church. */
  unsubscribeUrl: string;
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
            Headers: {
              // Required for bulk mail, and the honest counterpart to the
              // opt-in consent the church recorded in the first place.
              "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          },
        ],
      };

      let response: { status: number; json: () => Promise<unknown> };
      try {
        response = await transport(MAILJET_SEND_URL, {
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
}

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
    return err(`Email is not configured. Missing: ${missing.join(", ")}.`, "not_configured");
  }

  return ok({
    apiKey: required.apiKey as string,
    secretKey: required.secretKey as string,
    fromEmail: required.fromEmail as string,
    fromName: env.MAILJET_FROM_NAME ?? "GatherFlow",
    webhookSecret: required.webhookSecret as string,
    appUrl: env.BETTER_AUTH_URL ?? "http://localhost:3000",
  });
}
