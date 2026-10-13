"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlusIcon, QrCodeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceChart } from "@/components/dashboard/attendance-chart";
import { CreateSessionDialog } from "@/components/attendance/session-dialogs";
import { EmptyState } from "@/components/shared/empty-state";
import { StatTile } from "@/components/shared/metric-card";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { SERVICE_TYPE_LABELS } from "@/types/attendance";
import { useAttendance } from "@/hooks/useAttendance";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";

/**
 * Attendance: the sessions themselves, and the figures counted from their
 * records. Nothing here is stored as a total.
 */
export default function AttendancePage() {
  const now = useNow();
  const today = toIsoDate(now);
  const { can } = useDemoRole();
  const { summaries, trend, weeklyAverage, upcoming, addSession } = useAttendance();
  const [creating, setCreating] = useState(false);

  const recorded = summaries.filter((entry) => entry.total > 0);
  const firstTimeTotal = recorded.reduce((sum, entry) => sum + entry.firstTimeVisitors, 0);

  return (
    <PageShell>
      <PageHeader
        title="Attendance"
        description="Every figure below is counted from the attendance records for each session."
        actions={
          <>
            <LinkButton variant="outline" size="sm" href="/connect" target="_blank" className="gap-1.5">
              <QrCodeIcon />
              Visitor welcome page
            </LinkButton>
            {can("attendance.write") ? (
              <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
                <CalendarPlusIcon />
                New session
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Average weekly attendance"
          value={weeklyAverage.average}
          detail={`Mean of ${weeklyAverage.weeksCounted} recorded weeks`}
        />
        <StatTile
          label="Sessions recorded"
          value={recorded.length}
          detail="Sessions with at least one attendance record"
        />
        <StatTile
          label="First-time visitors"
          value={firstTimeTotal}
          detail="Counted on each person's own first visit"
        />
        <StatTile
          label="Upcoming sessions"
          value={upcoming.length}
          detail="Ready for check-in"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly attendance</CardTitle>
          <CardDescription>
            Members and visitors by week. People are grouped by what they are now — the demo does
            not model historical membership.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AttendanceChart data={trend} className="h-60 w-full" />
        </CardContent>
      </Card>

      {upcoming.length ? (
        <Section title="Coming up" description="Open a session to check people in.">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/attendance/${session.id}`}
                  className="block rounded-xl border p-3 hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{session.name}</p>
                    <Badge variant="secondary">{SERVICE_TYPE_LABELS[session.type]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDisplayDate(session.date)} · {session.startTime}
                    {session.date === today ? " · today" : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Recorded sessions" description="Newest first.">
        {recorded.length ? (
          <ul className="space-y-2">
            {recorded.map((entry) => (
              <li key={entry.session.id}>
                <Link
                  href={`/attendance/${entry.session.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{entry.session.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDisplayDate(entry.session.date)} ·{" "}
                      {SERVICE_TYPE_LABELS[entry.session.type]}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="tabular-nums">
                      <strong>{entry.total}</strong> present
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {entry.members} members · {entry.visitors} visitors
                    </span>
                    {entry.firstTimeVisitors ? (
                      <Badge variant="secondary">
                        {entry.firstTimeVisitors} first-time
                      </Badge>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No attendance recorded yet"
            description="Create a session and check people in — every attendance figure in GatherFlow is counted from those records."
          />
        )}
      </Section>

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
