import webpush, { WebPushError } from "web-push";
import type { PushConfig } from "./config";
import type { PushSender } from "./reminders";

/** Twelve hours: a reminder that arrives the next morning is worse than none. */
const TTL_SECONDS = 12 * 60 * 60;
/** A push service that does not answer must not hold up everybody after it. */
const TIMEOUT_MS = 10_000;

/**
 * Sends through the browser's push service with this deployment's VAPID
 * keys. A 404 or 410 means the browser unsubscribed or the subscription
 * expired, which is reported as `gone` so the run forgets it.
 */
export function createWebPushSender(config: PushConfig): PushSender {
  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: TTL_SECONDS,
        timeout: TIMEOUT_MS,
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      });
      return { ok: true };
    } catch (error: unknown) {
      if (error instanceof WebPushError) {
        return { ok: false, gone: error.statusCode === 404 || error.statusCode === 410, error: `${error.statusCode}` };
      }
      return { ok: false, gone: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
