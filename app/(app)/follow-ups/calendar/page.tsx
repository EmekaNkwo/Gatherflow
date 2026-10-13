"use client";

import Link from "next/link";
import {
  BellIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  HeartHandshakeIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { RestrictedBadge } from "@/components/shared/badges";
import { describeDueDate, formatDisplayDate } from "@/lib/dates";
import { WEEKDAYS } from "@/types/group";
import { useGroupSchedule } from "@/hooks/useGroups";
import { useNotifications, type AgendaEntry } from "@/hooks/useNotifications";
import { useNow } from "@/hooks/use-now";
import { usePastoralCare } from "@/hooks/usePastoralCare";

const ICONS: Record<AgendaEntry["kind"], typeof ClipboardListIcon> = {
  task: ClipboardListIcon,
  service: CalendarDaysIcon,
  group: UsersRoundIcon,
  care: HeartHandshakeIcon,
};

/**
 * The next two weeks of follow-up work, services and meetings.
 *
 * Reminders always come from the records themselves, so this works whether
 * or not browser notifications were ever allowed.
 */
export default function FollowUpCalendarPage() {
  const now = useNow();
  const { agenda, mine, permission, requestPermission, today } = useNotifications();
  const groups = useGroupSchedule();
  const care = usePastoralCare();

  const byDate = agenda.reduce<Record<string, AgendaEntry[]>>((acc, entry) => {
    (acc[entry.date] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <PageShell>
      <PageHeader
        title="Follow-up calendar"
        description="Everything due in the next two weeks, plus the services and meetings around it."
        actions={
          permission !== "granted" ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={requestPermission}>
              <BellIcon />
              {permission === "unsupported"
                ? "Notifications unsupported"
                : "Enable browser reminders"}
            </Button>
          ) : (
            <Badge variant="secondary">Browser reminders enabled</Badge>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section
            title="Agenda"
            description="Overdue work is listed first on its original due date, so nothing quietly disappears."
          >
            {Object.keys(byDate).length ? (
              <ol className="space-y-4">
                {Object.entries(byDate).map(([date, entries]) => (
                  <li key={date} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        {formatDisplayDate(date)}
                        {date === today ? " · today" : ""}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {describeDueDate(date, now)}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {entries.map((entry) => {
                        const Icon = ICONS[entry.kind];
                        return (
                          <li key={`${entry.kind}-${entry.id}`}>
                            <Link
                              href={entry.href}
                              className="flex items-start gap-3 rounded-lg border p-2.5 hover:bg-muted/50"
                            >
                              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium capitalize">{entry.title}</p>
                                <p className="text-xs text-muted-foreground">{entry.detail}</p>
                              </div>
                              {entry.overdue ? (
                                <Badge variant="destructive">Overdue</Badge>
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="Nothing scheduled in the next two weeks"
                description="Follow-up tasks and services appear here as they are created."
              />
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My reminders</CardTitle>
              <CardDescription>
                Shown here whether or not browser notifications are allowed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <strong className="tabular-nums">{mine.dueToday.length}</strong> due today
              </p>
              <p>
                <strong className="tabular-nums">{mine.overdue.length}</strong> overdue
              </p>
              <LinkButton variant="outline" size="sm" href="/follow-ups/my-tasks">
                Open my tasks
              </LinkButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Regular meetings</CardTitle>
              <CardDescription>Group and ministry schedules.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {groups.map(({ group, schedule }) => (
                  <li key={group.id} className="flex items-center justify-between gap-2">
                    <Link href={`/groups/${group.id}`} className="truncate hover:underline">
                      {group.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground capitalize">
                      {WEEKDAYS.includes(schedule.weekday) ? schedule.weekday : ""} {schedule.time}
                    </span>
                  </li>
                ))}
                {!groups.length ? (
                  <li className="text-muted-foreground">No groups have a schedule yet.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

          {care.authorised ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Care appointments
                  <RestrictedBadge />
                </CardTitle>
                <CardDescription>
                  Only visible to roles authorised for pastoral care.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {care.appointments.map(({ record, appointment }) => (
                    <li key={appointment.id} className="flex items-center justify-between gap-2">
                      <Link href="/pastoral-care" className="truncate hover:underline">
                        {record.reference}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDisplayDate(appointment.date)} · {appointment.time}
                      </span>
                    </li>
                  ))}
                  {!care.appointments.length ? (
                    <li className="text-muted-foreground">Nothing scheduled.</li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
