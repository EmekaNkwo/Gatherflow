"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  BellIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  HeartHandshakeIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { LinkButton } from "@/components/shared/link-button";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { RestrictedBadge } from "@/components/shared/badges";
import { addDaysIso, formatDisplayDate, parseDate } from "@/lib/dates";
import { FOLLOW_UP_TASK_TYPE_LABELS } from "@/types/follow-up";
import { WEEKDAYS, type Weekday } from "@/types/group";
import { useGroupSchedule } from "@/hooks/useGroups";
import { useNotifications, type AgendaEntry } from "@/hooks/useNotifications";
import { usePastoralCare } from "@/hooks/usePastoralCare";
import { useSnapshot } from "@/hooks/use-church-data";

const ICONS: Record<AgendaEntry["kind"], typeof UserRoundIcon> = {
  task: UserRoundIcon,
  service: CalendarDaysIcon,
  group: UsersRoundIcon,
  care: HeartHandshakeIcon,
};

const ROW = "flex min-h-14 items-center gap-3 px-5 py-3";

interface DayGroup {
  key: string;
  title: string;
  entries: AgendaEntry[];
}

/** "Today", "Tomorrow", or "Friday 18 Oct". */
function dayTitle(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDaysIso(today, 1)) return "Tomorrow";
  return format(parseDate(date), "EEEE d MMM");
}

/** Late work first, so nothing quietly disappears; then each day in turn. */
function groupByDay(agenda: readonly AgendaEntry[], today: string): DayGroup[] {
  const late = agenda.filter((entry) => entry.overdue || entry.date < today);
  const upcoming = agenda.filter((entry) => !(entry.overdue || entry.date < today));
  const days = upcoming.reduce<DayGroup[]>((groups, entry) => {
    const last = groups.at(-1);
    if (last && last.key === entry.date) {
      return [...groups.slice(0, -1), { ...last, entries: [...last.entries, entry] }];
    }
    return [...groups, { key: entry.date, title: dayTitle(entry.date, today), entries: [entry] }];
  }, []);
  return late.length ? [{ key: "late", title: "Running late", entries: late }, ...days] : days;
}

function weekly(weekday: Weekday, time: string): string {
  if (!WEEKDAYS.includes(weekday)) return time;
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}s at ${time}`;
}

/**
 * The next two weeks as an agenda: each day in turn, people first. Reminders
 * come from the records themselves, so this works whether or not browser
 * notifications were ever allowed.
 */
export default function FollowUpCalendarPage() {
  const snapshot = useSnapshot();
  const { agenda, mine, today } = useNotifications();
  const groups = useGroupSchedule();
  const care = usePastoralCare();

  const taskTypes = useMemo(
    () => new Map(snapshot.tasks.map((task) => [task.id, task.type])),
    [snapshot.tasks],
  );
  const days = useMemo(() => groupByDay(agenda, today), [agenda, today]);
  const waiting = mine.dueToday.length + mine.overdue.length;

  /** Person first for follow-ups; the service name for services. */
  const describe = (entry: AgendaEntry): { primary: string; secondary: string } => {
    if (entry.kind === "task") {
      const type = taskTypes.get(entry.id);
      return { primary: entry.detail, secondary: type ? FOLLOW_UP_TASK_TYPE_LABELS[type] : "Follow-up" };
    }
    return { primary: entry.title, secondary: entry.detail };
  };

  return (
    <PageShell className="max-w-3xl space-y-10">
      <PageHeader
        title="Calendar"
        description="The next two weeks: who to follow up, and when the church meets."
        actions={
          <LinkButton variant="ghost" className="gap-1.5 rounded-full" href="/account">
            <BellIcon />
            Daily reminders
          </LinkButton>
        }
      />

      {waiting ? (
        <section className="flex flex-col gap-4 rounded-[2rem] bg-warm px-6 py-6 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <p className="text-lg">
            {mine.dueToday.length ? `${mine.dueToday.length} of yours for today` : null}
            {mine.dueToday.length && mine.overdue.length ? ", and " : null}
            {mine.overdue.length ? `${mine.overdue.length} still waiting from before` : null}.
          </p>
          <LinkButton size="lg" href="/follow-ups/my-tasks" className="shrink-0 rounded-full">
            Open my follow-ups
            <ArrowRightIcon />
          </LinkButton>
        </section>
      ) : null}

      {days.length ? (
        <div className="space-y-8">
          {days.map((day) => (
            <Section key={day.key} title={day.title}>
              <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
                {day.entries.map((entry) => {
                  const Icon = ICONS[entry.kind];
                  const { primary, secondary } = describe(entry);
                  return (
                    <li key={`${entry.kind}-${entry.id}`}>
                      <Link href={entry.href} className={`${ROW} hover:bg-muted/50`}>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{primary}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {secondary}
                            {day.key === "late" ? ` · was due ${format(parseDate(entry.date), "EEE d MMM")}` : ""}
                          </span>
                        </span>
                        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">
          Nothing in the next two weeks. Follow-ups and services show up here as they’re added.
        </p>
      )}

      {care.authorised && care.appointments.length ? (
        <Section
          title="Care appointments"
          description="Only people who look after pastoral care can see these."
          actions={<RestrictedBadge />}
        >
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {care.appointments.map(({ record, appointment }) => (
              <li key={appointment.id}>
                <Link href="/pastoral-care" className={`${ROW} hover:bg-muted/50`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {formatDisplayDate(appointment.date)} at {appointment.time}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {appointment.location ? `${appointment.location} · ` : ""}
                      {record.reference}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {groups.length ? (
        <Section title="Group meetings">
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {groups.map(({ group, schedule }) => (
              <li key={group.id}>
                <Link href={`/groups/${group.id}`} className={`${ROW} hover:bg-muted/50`}>
                  <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {weekly(schedule.weekday, schedule.time)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </PageShell>
  );
}
