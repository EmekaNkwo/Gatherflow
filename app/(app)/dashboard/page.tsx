"use client";

import { WelcomeButton } from "@/components/visitors/welcome-button";
import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRightIcon, UserPlusIcon } from "lucide-react";
import { AttentionList } from "@/components/dashboard/attention-list";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { RescheduleDialog } from "@/components/follow-ups/reschedule-dialog";
import { TaskList } from "@/components/follow-ups/task-list";
import { PageShell, Section } from "@/components/shared/page-header";
import { LinkButton } from "@/components/shared/link-button";
import { toIsoDate } from "@/lib/dates";
import { useDashboard } from "@/hooks/useChurchAnalytics";
import { useRole } from "@/hooks/useRole";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useNow } from "@/hooks/use-now";
import { greeting, workSentence } from "@/services/today/summary";
import type { TaskWithPerson, TaskFilters } from "@/services/follow-ups/selectors";
import { useSessionStore } from "@/stores/session-store";
import type { TaskOutcome } from "@/types/follow-up";

/**
 * Today: what is waiting for *you*, said in a sentence, with the people to
 * reach right underneath. Staff also see what needs a decision and a few
 * plain facts about the church; the charts live in Reports.
 */
export default function TodayPage() {
  const now = useNow();
  const dashboard = useDashboard();
  const { currentMember, can } = useRole();
  const teamMemberId = useSessionStore((state) => state.teamMemberId) ?? undefined;

  const todayFilters = useMemo<TaskFilters>(() => ({ due: "today", assigneeId: teamMemberId }), [teamMemberId]);
  const overdueFilters = useMemo<TaskFilters>(() => ({ due: "overdue", assigneeId: teamMemberId }), [teamMemberId]);
  const upcomingFilters = useMemo<TaskFilters>(() => ({ due: "upcoming", assigneeId: teamMemberId }), [teamMemberId]);
  const todayAll = useFollowUps(todayFilters);
  const overdueAll = useFollowUps(overdueFilters);
  const upcomingAll = useFollowUps(upcomingFilters);
  // An account not acting as a team member has nothing of its own; without
  // this, an empty assignee filter would show everyone's work as theirs.
  const linked = teamMemberId !== undefined;
  const today = { ...todayAll, tasks: linked ? todayAll.tasks : [] };
  const overdue = { ...overdueAll, tasks: linked ? overdueAll.tasks : [] };
  const upcoming = { ...upcomingAll, tasks: linked ? upcomingAll.tasks : [] };

  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);
  const canWork = can("tasks.write");

  const onComplete = async (outcome: TaskOutcome, note?: string) => {
    if (!completing) return;
    const result = await today.complete(completing.task.id, outcome, note);
    // A task finished elsewhere is re-read; keeping the dialog would only refuse again.
    if (result.ok || result.code === "closed" || result.code === "not_found") setCompleting(null);
  };

  const onReschedule = async (dueDate: string, reason?: string) => {
    if (!rescheduling) return;
    const result = await today.reschedule(rescheduling.task.id, dueDate, reason);
    if (result.ok) setRescheduling(null);
  };

  const nothingWaiting = today.tasks.length === 0 && overdue.tasks.length === 0;
  const metric = (key: string) => dashboard.metrics.find((entry) => entry.key === key);
  const facts = [
    metric("first_time_visitors"),
    metric("average_attendance"),
    metric("awaiting_assignment"),
  ].filter((entry) => entry !== undefined);

  return (
    <PageShell className="max-w-4xl space-y-10">
      <section className="rounded-[2rem] bg-warm px-6 py-8 md:px-10 md:py-12">
        <p className="text-sm font-medium text-muted-foreground">{format(now, "EEEE d MMMM")}</p>
        <h1 className="mt-1 font-heading text-4xl leading-tight font-medium md:text-5xl">
          {greeting(currentMember?.name, now)}
        </h1>
        <p className="mt-3 max-w-xl text-lg md:text-xl">
          {workSentence({ dueToday: today.tasks.length, overdue: overdue.tasks.length })}
        </p>
        <WelcomeButton size="lg" className="mt-6 rounded-full">
          <UserPlusIcon />
          Welcome someone new
        </WelcomeButton>
      </section>

      {overdue.tasks.length ? (
        <Section title="Still waiting" description="From earlier days. Reach them when you can, or move them to another day.">
          <TaskList
            tasks={overdue.tasks}
            now={now}
            emptyMessage=""
            onComplete={canWork ? setCompleting : undefined}
            onReschedule={canWork ? setRescheduling : undefined}
          />
        </Section>
      ) : null}

      {today.tasks.length ? (
        <Section title="Today">
          <TaskList
            tasks={today.tasks}
            now={now}
            emptyMessage=""
            onComplete={canWork ? setCompleting : undefined}
            onReschedule={canWork ? setRescheduling : undefined}
          />
        </Section>
      ) : null}

      {nothingWaiting && upcoming.tasks.length ? (
        <Section
          title="Coming up"
          actions={
            <LinkButton variant="ghost" size="sm" href="/follow-ups/calendar">
              Calendar
              <ArrowRightIcon />
            </LinkButton>
          }
        >
          <TaskList tasks={upcoming.tasks} now={now} limit={4} emptyMessage="" />
        </Section>
      ) : null}

      {can("tasks.read.all") ? (
        <Section title="Needs a decision" description="Most urgent first.">
          <AttentionList items={dashboard.attention} />
        </Section>
      ) : null}

      {can("analytics.read") && facts.length ? (
        <Section
          title="At church lately"
          actions={
            <LinkButton variant="ghost" size="sm" href="/reports">
              All reports
              <ArrowRightIcon />
            </LinkButton>
          }
        >
          <ul className="grid gap-3 sm:grid-cols-3">
            {facts.map((fact) => (
              <li key={fact.key}>
                <Link
                  href={fact.href}
                  className="flex h-full flex-col gap-1 rounded-3xl border bg-card px-5 py-4 hover:bg-muted/50"
                >
                  <span className="font-heading text-3xl font-medium">{fact.value}</span>
                  <span className="text-sm text-muted-foreground">{fact.label.toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <CompleteTaskDialog
        task={completing}
        onOpenChange={(open) => !open && setCompleting(null)}
        onConfirm={onComplete}
      />
      <RescheduleDialog
        task={rescheduling}
        today={toIsoDate(now)}
        onOpenChange={(open) => !open && setRescheduling(null)}
        onConfirm={onReschedule}
      />
    </PageShell>
  );
}
