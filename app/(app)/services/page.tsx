"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlusIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateSessionDialog } from "@/components/attendance/session-dialogs";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { SERVICE_TYPE_LABELS } from "@/types/attendance";
import { WEEKDAYS, type Weekday } from "@/types/group";
import { useAttendance } from "@/hooks/useAttendance";
import { useGroupSchedule } from "@/hooks/useGroups";
import { useSnapshot } from "@/hooks/use-church-data";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";

/** "Every Sunday at 10:00". */
function everyWeek(weekday: Weekday, time: string): string {
  const day = WEEKDAYS.includes(weekday) ? `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}` : "week";
  return `Every ${day} at ${time}`;
}

const ROW = "flex min-h-14 items-center gap-3 px-5 py-3";

/**
 * Services: when the church meets, in plain words. What's coming up is one
 * tap from check-in; adding a one-off service is the single action here.
 */
export default function ServicesPage() {
  const snapshot = useSnapshot();
  const now = useNow();
  const { can } = useRole();
  const { upcoming, addSession } = useAttendance();
  const groups = useGroupSchedule();
  const [creating, setCreating] = useState(false);

  const services = [...snapshot.settings.services].sort(
    (left, right) =>
      WEEKDAYS.indexOf(left.weekday) - WEEKDAYS.indexOf(right.weekday) || left.time.localeCompare(right.time),
  );

  return (
    <PageShell className="max-w-3xl space-y-10">
      <PageHeader
        title="Services & events"
        description="When the church meets, and what’s coming up."
        actions={
          can("attendance.write") ? (
            <Button size="lg" className="gap-1.5 rounded-full" onClick={() => setCreating(true)}>
              <CalendarPlusIcon />
              Add a service
            </Button>
          ) : null
        }
      />

      <Section title="Coming up">
        {upcoming.length ? (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {upcoming.map((session) => (
              <li key={session.id}>
                <Link href={`/attendance/${session.id}`} className={`${ROW} hover:bg-muted/50`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{session.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {formatDisplayDate(session.date)} at {session.startTime}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">
            {can("attendance.write")
              ? "Nothing coming up yet. Add a service and it will be ready for check-in."
              : "Nothing coming up yet. When a service is added, it will be ready for check-in."}
          </p>
        )}
      </Section>

      <Section
        title="Every week"
        description={can("settings.write") ? undefined : "Your church’s regular pattern."}
        actions={
          can("settings.write") ? (
            <Link href="/settings" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
              Change in Settings
            </Link>
          ) : null
        }
      >
        {services.length ? (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {services.map((service) => (
              <li key={service.id} className={ROW}>
                <span className="min-w-0 flex-1">
                  <span className={service.active ? "block truncate font-medium" : "block truncate font-medium text-muted-foreground"}>
                    {service.name}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {everyWeek(service.weekday, service.time)} · {SERVICE_TYPE_LABELS[service.type]}
                  </span>
                </span>
                {!service.active ? (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Paused
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">No regular services set up yet.</p>
        )}
      </Section>

      <Section title="Group meetings">
        {groups.length ? (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {groups.map(({ group, schedule }) => (
              <li key={group.id}>
                <Link href={`/groups/${group.id}`} className={`${ROW} hover:bg-muted/50`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{group.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {everyWeek(schedule.weekday, schedule.time)}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">
            No group has a regular meeting time yet.
          </p>
        )}
      </Section>

      <CreateSessionDialog
        open={creating}
        onOpenChange={setCreating}
        today={toIsoDate(now)}
        onConfirm={async (input) => {
          const outcome = await addSession(input);
          if (outcome.ok) setCreating(false);
        }}
      />
    </PageShell>
  );
}
