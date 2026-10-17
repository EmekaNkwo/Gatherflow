"use client";

import { BellRingIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushReminders } from "@/hooks/usePushReminders";

/**
 * Daily reminders on this browser. They arrive with GatherFlow closed, and
 * say only how many follow-ups are due — never who they are about.
 */
export function RemindersCard() {
  const { state, busy, enable, disable } = usePushReminders();

  return (
    <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-medium">
          <BellRingIcon className="size-5 text-muted-foreground" />
          Daily reminders
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          Once a day, this browser tells you how many follow-ups are due or overdue for you — even with GatherFlow
          closed. The message has counts only, never names.
        </p>
      </div>
      <div className="space-y-3 text-sm">
        {state.status === "loading" ? <p className="text-muted-foreground">Checking this browser…</p> : null}
        {state.status === "unavailable" ? <p className="text-muted-foreground">{state.reason}</p> : null}
        {state.status === "blocked" ? (
          <p className="text-muted-foreground">
            Notifications are blocked for this site. Allow them in the browser&apos;s site settings, then come back.
          </p>
        ) : null}
        {state.status === "off" ? (
          <Button size="lg" className="w-fit rounded-full" disabled={busy} onClick={() => void enable()}>
            Turn on for this browser
          </Button>
        ) : null}
        {state.status === "on" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="status">On for this browser.</p>
            <Button variant="outline" size="lg" className="w-fit rounded-full" disabled={busy} onClick={() => void disable()}>
              Turn off
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
