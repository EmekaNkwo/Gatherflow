"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchPushStatus, subscribePush, unsubscribePush } from "@/services/commands/client";

/**
 * Daily reminders on this browser, delivered by Web Push so they arrive with
 * GatherFlow closed. `unavailable` covers both a browser without push and a
 * deployment without VAPID keys; the reason says which.
 */
export type PushReminderState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "blocked" }
  | { status: "off"; publicKey: string }
  | { status: "on"; publicKey: string };

function browserSupportsPush(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** The VAPID public key, as the byte array `pushManager.subscribe` wants. */
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function readState(): Promise<PushReminderState> {
  if (!browserSupportsPush()) return { status: "unavailable", reason: "This browser cannot receive reminders." };
  const existing = await currentSubscription();
  const status = await fetchPushStatus(existing?.endpoint);
  if (!status.ok) return { status: "unavailable", reason: status.error };
  if (!status.value.available || !status.value.publicKey) {
    return { status: "unavailable", reason: "Reminders are not set up on this deployment yet." };
  }
  if (Notification.permission === "denied") return { status: "blocked" };
  return status.value.subscribed
    ? { status: "on", publicKey: status.value.publicKey }
    : { status: "off", publicKey: status.value.publicKey };
}

export function usePushReminders() {
  const [state, setState] = useState<PushReminderState>({ status: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (state.status !== "off") return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? { status: "blocked" } : state);
        toast.info("Reminders stay in the dashboard — nothing will pop up.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) }));
      const saved = await subscribePush(subscription.toJSON());
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      setState({ status: "on", publicKey: state.publicKey });
      toast.success("Daily reminders are on for this browser.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Reminders could not be turned on.");
    } finally {
      setBusy(false);
    }
  }, [state]);

  const disable = useCallback(async () => {
    if (state.status !== "on") return;
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        // The server goes first: while it still holds the browser, reminders
        // are still on, whatever the browser says.
        const removed = await unsubscribePush(subscription.endpoint);
        if (!removed.ok) {
          toast.error(removed.error);
          return;
        }
        // Once the server has forgotten it, nothing more is sent here, so a
        // browser that fails to tidy up its own subscription changes nothing.
        await subscription.unsubscribe().catch(() => false);
      }
      setState({ status: "off", publicKey: state.publicKey });
      toast.success("Daily reminders are off for this browser.");
    } finally {
      setBusy(false);
    }
  }, [state]);

  return { state, busy, enable, disable };
}
