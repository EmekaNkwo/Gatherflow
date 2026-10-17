"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { formatDisplayDateTime } from "@/lib/dates";
import { fetchEmailStatus, type RemoteEmailStatus } from "@/services/commands/client";
import { SettingsPanel } from "./settings-panel";

/**
 * The state of email for this church, for an administrator.
 *
 * It answers two questions: is sending offered, and which messages have
 * given up — subject and address only, never a body.
 */
export function EmailDeliveryCard() {
  const [status, setStatus] = useState<RemoteEmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchEmailStatus(controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.ok) setStatus(outcome.value);
      else setError(outcome.error);
    });
    return () => controller.abort();
  }, []);

  const availability = status?.availability;
  const label = availability
    ? availability.enabled
      ? availability.pilot
        ? "Trial"
        : "On"
      : availability.configured
        ? "Switched off"
        : "Not set up"
    : null;

  return (
    <SettingsPanel
      title="Email"
      status={
        label ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-sans text-sm font-medium",
              availability?.enabled && !availability.pilot ? "bg-done text-done-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {label}
          </span>
        ) : null
      }
      description={
        availability?.enabled
          ? availability.pilot
            ? "Real email is sent, but only to the addresses on the trial list."
            : "Email goes out through your church's provider. What Sent messages says about each one is what the provider told us."
          : (availability?.reason ?? "Checking…")
      }
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {status && status.failures.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every email so far has gone out.</p>
      ) : null}

      {status && status.failures.length > 0 ? (
        <div className="space-y-3">
          <p className="font-medium">
            {status.failures.length} {status.failures.length === 1 ? "email" : "emails"} could not be sent, and
            won&apos;t be tried again
          </p>
          <ul className="space-y-2">
            {status.failures.map((failure) => (
              <li key={failure.outboxId} className="rounded-2xl bg-muted px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/members/${failure.personId}`} className="font-medium underline-offset-4 hover:underline">
                    {failure.toEmail}
                  </Link>
                  <span className="text-muted-foreground">
                    {formatDisplayDateTime(failure.updatedAt)} · {failure.attempts}{" "}
                    {failure.attempts === 1 ? "try" : "tries"}
                  </span>
                </div>
                <p className="text-muted-foreground">{failure.subject}</p>
                {failure.lastError ? (
                  <p className="mt-1 line-clamp-2 font-mono text-xs text-muted-foreground">{failure.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SettingsPanel>
  );
}
