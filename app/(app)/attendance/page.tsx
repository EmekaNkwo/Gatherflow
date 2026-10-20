"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CalendarPlusIcon, ChevronRightIcon, QrCodeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { AttendanceChart } from "@/components/dashboard/attendance-chart";
import { CreateSessionDialog } from "@/components/attendance/session-dialogs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { SERVICE_TYPE_LABELS } from "@/types/attendance";
import type { WeeklyAverage } from "@/services/analytics/attendance";
import { useAttendance } from "@/hooks/useAttendance";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useChurchStore } from "@/stores/church-store";

/** A complete `session.create` input, only to ask whether this role may run it. */
const NEW_SERVICE_PROBE = {
  name: "Service",
  date: "2000-01-01",
  startTime: "10:00",
  type: "sunday_service",
} as const;

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * "About 75 people a week, over the last 5 completed weeks. So far this
 * week: 12 people." The current week is never part of the average, so the
 * figure does not move with every check-in on a Sunday morning.
 */
function weeklySentence(weekly: WeeklyAverage): string {
  const weeks = weekly.weeksCounted === 1 ? "completed week" : `${weekly.weeksCounted} completed weeks`;
  const soFar = weekly.thisWeek ? ` So far this week: ${people(weekly.thisWeek)}.` : "";
  return (
    `About ${people(Math.round(weekly.average))} a week, over the last ${weeks} with a service.${soFar}` +
    " Somebody at two services in one week counts once, and a member counts as a visitor at anything before their membership date."
  );
}

/**
 * Check-in: the next service first, with one button to start ticking people
 * off; recent services underneath. Staff also see how attendance is going,
 * in a sentence and a chart. Every figure is counted from the records.
 */
export default function AttendancePage() {
  const now = useNow();
  const today = toIsoDate(now);
  const { can, canRun } = useRole();
  const churchId = useChurchStore((state) => state.churchId);
  const { summaries, trend, weeklyAverage, upcoming, past, addSession } = useAttendance();
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const canAddService = canRun("session.create", NEW_SERVICE_PROBE);
  // Services that have happened: everything in the last few weeks, even with
  // nobody checked in (so a service added afterwards can be filled in), and
  // older ones that have attendance. Today's services are "Today" above.
  const recentIds = new Set(past.map((session) => session.id));
  const recorded = summaries.filter(
    (entry) => entry.session.date < today && (recentIds.has(entry.session.id) || entry.total > 0),
  );
  const [next, ...later] = upcoming;
  const recent = showAll ? recorded : recorded.slice(0, 4);

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PageHeader
        title="Check-in"
        description="Pick the service and tick people off as they arrive."
        actions={
          <>
            {can("settings.write") && churchId ? (
              <LinkButton variant="ghost" href={`/connect/${churchId}`} target="_blank" className="gap-1.5 rounded-full">
                <QrCodeIcon />
                Welcome page
              </LinkButton>
            ) : null}
            {canAddService ? (
              <Button variant="outline" className="gap-1.5 rounded-full" onClick={() => setCreating(true)}>
                <CalendarPlusIcon />
                Add a service
              </Button>
            ) : null}
          </>
        }
      />

      {next ? (
        <section className="flex flex-col gap-5 rounded-[2rem] bg-warm px-6 py-7 sm:flex-row sm:items-center sm:justify-between md:px-10">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {next.date === today ? "Today" : "Next"} · {formatDisplayDate(next.date)} at {next.startTime}
            </p>
            <h2 className="mt-1 text-3xl font-medium">{next.name}</h2>
          </div>
          <LinkButton
            size="lg"
            variant={next.date === today ? "default" : "outline"}
            href={`/attendance/${next.id}`}
            className="h-12 rounded-full px-6 text-base"
          >
            {/* Check-in opens on the day; before then the page is for getting ready. */}
            {next.date === today ? "Start check-in" : "See the service"}
            <ArrowRightIcon />
          </LinkButton>
        </section>
      ) : (
        <EmptyState
          title="No service coming up"
          description={
            canAddService
              ? "Your weekly pattern in Settings is a guide only: a service appears here once it is added for a date. Add the next one and it will be ready for check-in."
              : "When the next service is added for a date, it will be ready for check-in here."
          }
        />
      )}

      {later.length ? (
        <Section title="After that">
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {later.map((session) => (
              <li key={session.id}>
                <Link href={`/attendance/${session.id}`} className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-muted/50">
                  <span className="flex-1">
                    <span className="block font-medium">{session.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {formatDisplayDate(session.date)} at {session.startTime}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Recent services">
        {recorded.length ? (
          <>
            <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
              {recent.map((entry) => (
                <li key={entry.session.id}>
                  <Link
                    href={`/attendance/${entry.session.id}`}
                    className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{entry.session.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {formatDisplayDate(entry.session.date)} · {SERVICE_TYPE_LABELS[entry.session.type]}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-medium tabular-nums">
                        {entry.total === 1 ? "1 person" : `${entry.total} people`}
                      </span>
                      {entry.firstTimeVisitors ? (
                        <span className="block text-sm text-primary tabular-nums">{entry.firstTimeVisitors} new</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {recorded.length > recent.length || showAll ? (
              <Button variant="ghost" className="rounded-full" onClick={() => setShowAll((all) => !all)}>
                {showAll ? "Show fewer" : `Show all ${recorded.length}`}
              </Button>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="No services yet"
            description="Once a service has happened, it appears here with how many came."
          />
        )}
      </Section>

      {can("analytics.read") && trend.length ? (
        <Section
          title="How attendance is going"
          description={
            weeklyAverage.weeksCounted
              ? weeklySentence(weeklyAverage)
              : weeklyAverage.thisWeek
                ? `So far this week: ${people(weeklyAverage.thisWeek)}. The weekly figure appears once a full week has been recorded.`
                : "Nobody has been checked in yet, so there is no weekly figure. It appears after the first service with attendance."
          }
        >
          <div className="rounded-3xl border bg-card p-5">
            <AttendanceChart data={trend} className="h-60 w-full" />
          </div>
        </Section>
      ) : null}

      <CreateSessionDialog
        open={creating}
        onOpenChange={setCreating}
        today={today}
        onConfirm={async (input) => {
          const outcome = await addSession(input);
          if (outcome.ok) setCreating(false);
        }}
      />
    </PageShell>
  );
}
