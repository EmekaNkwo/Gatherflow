"use client";

import Link from "next/link";
import { CalendarPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { formatDisplayDate } from "@/lib/dates";
import { SERVICE_TYPE_LABELS } from "@/types/attendance";
import { useAttendance } from "@/hooks/useAttendance";
import { useGroupSchedule } from "@/hooks/useGroups";
import { useSnapshot } from "@/hooks/use-church-data";

/**
 * The regular rhythm of the church — the services it runs each week, the
 * sessions scheduled next, and the group meetings around them.
 */
export default function ServicesPage() {
  const snapshot = useSnapshot();
  const { upcoming } = useAttendance();
  const groups = useGroupSchedule();

  return (
    <PageShell>
      <PageHeader
        title="Services & events"
        description="The weekly pattern, and what is scheduled next. Service definitions are edited in Settings."
        actions={
          <LinkButton size="sm" href="/attendance" className="gap-1.5">
            <CalendarPlusIcon />
            Record attendance
          </LinkButton>
        }
      />

      <Section title="Regular services" description="Configured in Settings.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {snapshot.settings.services.map((service) => (
            <Card key={service.id} className={service.active ? undefined : "opacity-70"}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  {service.name}
                  {!service.active ? <Badge variant="outline">Paused</Badge> : null}
                </CardTitle>
                <CardDescription className="capitalize">
                  {service.weekday} · {service.time} · {SERVICE_TYPE_LABELS[service.type]}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Scheduled next" description="Sessions ready for check-in.">
        {upcoming.length ? (
          <ul className="space-y-2">
            {upcoming.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/attendance/${session.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{session.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDisplayDate(session.date)} · {session.startTime}
                    </p>
                  </div>
                  <Badge variant="secondary">{SERVICE_TYPE_LABELS[session.type]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nothing scheduled yet"
            description="Create a session from the attendance page to open check-in for it."
          />
        )}
      </Section>

      <Section title="Group meetings" description="The regular pattern for groups and ministries.">
        {groups.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map(({ group, schedule }) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border p-3 hover:bg-muted/50"
                >
                  <span className="truncate">{group.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground capitalize">
                    {schedule.weekday} {schedule.time}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No group schedules"
            description="Add a schedule when creating a group."
          />
        )}
      </Section>
    </PageShell>
  );
}
