"use client";

import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AttendanceChart } from "@/components/dashboard/attendance-chart";
import { AttentionList } from "@/components/dashboard/attention-list";
import { VisitorFunnel } from "@/components/dashboard/visitor-funnel";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { RescheduleDialog } from "@/components/follow-ups/reschedule-dialog";
import { TaskList } from "@/components/follow-ups/task-list";
import { MetricCard, RatioStat, StatTile } from "@/components/shared/metric-card";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toIsoDate } from "@/lib/dates";
import { useChurchAnalytics, useDashboard } from "@/hooks/useChurchAnalytics";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useNow } from "@/hooks/use-now";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import type { TaskOutcome } from "@/types/follow-up";

/**
 * The overview answers three questions: who attended, who needs attention,
 * and what the team should do next. Every number links to the list it came
 * from.
 */
export default function DashboardPage() {
  const now = useNow();
  const dashboard = useDashboard();
  const analytics = useChurchAnalytics();
  const { currentMember, can } = useDemoRole();
  const { tasks, complete, reschedule } = useFollowUps({ due: "today" });
  const overdue = useFollowUps({ due: "overdue" });

  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);

  const onComplete = (outcome: TaskOutcome, note?: string) => {
    if (!completing) return;
    const result = complete(completing.task.id, outcome, note);
    if (result.ok) setCompleting(null);
  };

  const onReschedule = (dueDate: string, reason?: string) => {
    if (!rescheduling) return;
    const result = reschedule(rescheduling.task.id, dueDate, reason);
    if (result.ok) setRescheduling(null);
  };

  return (
    <PageShell>
      <PageHeader
        title={`${dashboard.churchName} overview`}
        description={`Signed in as ${currentMember?.name ?? "a demo user"}. Everything below is counted from the records stored in this browser.`}
        actions={
          <>
            <LinkButton variant="outline" size="sm" href="/visitors/quick">
              Quick registration
            </LinkButton>
            <LinkButton size="sm" href="/visitors/new">
              Register a visitor
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Weekly attendance</CardTitle>
            <CardDescription>
              Counted from attendance records for the last {analytics.attendanceTrend.length} weeks.
              Average {analytics.weeklyAverage.average} across{" "}
              {analytics.weeklyAverage.weeksCounted} recorded weeks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AttendanceChart data={analytics.attendanceTrend} className="h-56 w-full" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Visitor journey</CardTitle>
            <CardDescription>Where visitors are in the follow-up pipeline right now.</CardDescription>
          </CardHeader>
          <CardContent>
            <VisitorFunnel stages={dashboard.visitorFunnel} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section
            title="Today's follow-ups"
            description="Open tasks due today, highest priority first."
            actions={
              <LinkButton variant="ghost" size="sm" href="/follow-ups/tasks?due=today">
                View all
                <ArrowRightIcon />
              </LinkButton>
            }
          >
            <TaskList
              tasks={tasks}
              now={now}
              limit={5}
              emptyMessage="Nothing is due today. Overdue work, if any, is listed below."
              onComplete={can("tasks.write") ? (task) => setCompleting(task) : undefined}
              onReschedule={can("tasks.write") ? (task) => setRescheduling(task) : undefined}
            />
          </Section>

          {overdue.tasks.length ? (
            <Section
              title="Overdue follow-ups"
              description="Past their due date. Complete them or move the date with a reason."
            >
              <TaskList
                tasks={overdue.tasks}
                now={now}
                limit={5}
                emptyMessage="Nothing is overdue."
                onComplete={can("tasks.write") ? (task) => setCompleting(task) : undefined}
                onReschedule={can("tasks.write") ? (task) => setRescheduling(task) : undefined}
              />
            </Section>
          ) : null}

          <Section title="Needs attention" description="Sorted by how urgent it is.">
            <AttentionList items={dashboard.attention} />
          </Section>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My work</CardTitle>
              <CardDescription>
                Tasks assigned to {currentMember?.name ?? "you"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <StatTile label="Open" value={dashboard.personal.open} />
              <StatTile label="Due today" value={dashboard.personal.dueToday} />
              <StatTile label="Overdue" value={dashboard.personal.overdue} />
              <StatTile label="Done this week" value={dashboard.personal.completedThisWeek} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Follow-up health</CardTitle>
              <CardDescription>Rates always show the counts behind them.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RatioStat
                label="Follow-ups completed"
                ratio={dashboard.followUp.completed}
                explanation="Of all tasks that have reached a conclusion."
              />
              <RatioStat
                label="Completed on time"
                ratio={dashboard.followUp.onTime}
                explanation="Completed on or before the due date."
              />
              <RatioStat
                label="Visitors who returned"
                ratio={analytics.journey.returned}
                explanation={`First-time visitors between ${analytics.range.from} and ${analytics.range.to}.`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>
                Pastoral-care activity is not shown here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed events={dashboard.recentActivity} now={now} />
            </CardContent>
          </Card>
        </div>
      </div>

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
