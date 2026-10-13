"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceChart } from "@/components/dashboard/attendance-chart";
import { RatioStat, StatTile } from "@/components/shared/metric-card";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { formatRatio } from "@/lib/metrics";
import { addDaysIso, toIsoDate } from "@/lib/dates";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType } from "@/types/attendance";
import { useChurchAnalytics } from "@/hooks/useChurchAnalytics";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";

const VISITOR_CHART = {
  count: { label: "First-time visitors", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Reporting.
 *
 * Every rate shows the counts it came from and the window it covers, and the
 * criteria behind any judgement — such as "not seen recently" — are printed
 * next to the figures rather than hidden in the code.
 */
export default function ReportsPage() {
  const now = useNow();
  const { can } = useDemoRole();

  const [from, setFrom] = useState(() => addDaysIso(toIsoDate(now), -90));
  const [to, setTo] = useState(() => toIsoDate(now));
  const [serviceType, setServiceType] = useState<ServiceType | "">("");

  const analytics = useChurchAnalytics(
    useMemo(
      () => ({
        range: { from, to },
        serviceType: serviceType || undefined,
        weeks: 12,
      }),
      [from, to, serviceType],
    ),
  );

  if (!can("analytics.read")) {
    return (
      <PageShell>
        <RestrictedState section="Reports and analytics" />
      </PageShell>
    );
  }

  const journey = analytics.journey;

  return (
    <PageShell>
      <PageHeader
        title="Reports & analytics"
        description="Counted from the stored records every time this page renders — nothing is cached, so the figures cannot drift from the data."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-40">
          <FieldLabel htmlFor="report-from">From</FieldLabel>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field className="w-40">
          <FieldLabel htmlFor="report-to">To</FieldLabel>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <Field className="w-56">
          <FieldLabel htmlFor="report-service">Service</FieldLabel>
          <NativeSelect
            className="w-full"
            id="report-service"
            value={serviceType}
            onChange={(event) => setServiceType(event.target.value as ServiceType | "")}
          >
            <NativeSelectOption value="">All services</NativeSelectOption>
            {SERVICE_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {SERVICE_TYPE_LABELS[type]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Tabs defaultValue="engagement">
        <TabsList>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="journey">Visitor journey</TabsTrigger>
          <TabsTrigger value="team">Team workload</TabsTrigger>
        </TabsList>

        <TabsContent value="engagement" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Weekly attendance</CardTitle>
                <CardDescription>
                  {serviceType ? SERVICE_TYPE_LABELS[serviceType] : "All services"} · average{" "}
                  {analytics.weeklyAverage.average} across{" "}
                  {analytics.weeklyAverage.weeksCounted} recorded weeks.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AttendanceChart data={analytics.attendanceTrend} className="h-56 w-full" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>First-time visitors by month</CardTitle>
                <CardDescription>
                  Counted on each person&apos;s own first recorded visit.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={VISITOR_CHART} className="h-56 w-full">
                  <BarChart data={analytics.visitorTrend}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <RatioStat
                  label="Follow-ups completed"
                  ratio={analytics.followUp.completed}
                  explanation={`Tasks concluded between ${from} and ${to}.`}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <RatioStat
                  label="Completed on time"
                  ratio={analytics.followUp.onTime}
                  explanation="Completed on or before the due date."
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <RatioStat
                  label="Overdue right now"
                  ratio={analytics.overdueRate}
                  explanation="Share of open tasks past their due date."
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <RatioStat
                  label="Members in an active group"
                  ratio={analytics.groupParticipation}
                  explanation="Excludes archived and transferred members."
                />
              </CardContent>
            </Card>
          </div>

          <Section
            title="Membership"
            description={`"Flagged for review" means no recorded attendance for ${analytics.criteria.inactiveAfterWeeksAbsent} weeks. Nothing is reclassified automatically.`}
          >
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {analytics.membership.map((entry) => (
                <StatTile key={entry.status} label={entry.label} value={entry.count} />
              ))}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="journey" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Visitor journey</CardTitle>
              <CardDescription>
                Every rate below uses the same denominator: the {journey.cohortSize} first-time
                visitors whose first visit falls between {journey.range.from} and{" "}
                {journey.range.to}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <RatioStat label="Contacted" ratio={journey.contacted} />
              <RatioStat label="Returned" ratio={journey.returned} />
              <RatioStat label="Asked about membership" ratio={journey.requestedOrientation} />
              <RatioStat label="Became members" ratio={journey.becameMembers} />
              <RatioStat label="Joined a group" ratio={journey.joinedGroup} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What the numbers do not say</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {journey.closed} of these records are closed — paused, declined, referred on, or
                closed after the agreed number of attempts. A closed record is a respected
                decision, not a failure.
              </p>
              <p>
                These figures describe what the church did and what was recorded. They say nothing
                about anybody&apos;s faith or commitment, and should not be read that way.
              </p>
              <p>Follow-up completion in this window: {formatRatio(analytics.followUp.completed)}.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Volunteer workload</CardTitle>
              <CardDescription>
                For distributing work fairly. Task counts are a measure of capacity, never of
                anybody&apos;s worth.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Team member</th>
                      <th className="py-2 pr-4 font-medium">Role</th>
                      <th className="py-2 pr-4 font-medium">Open</th>
                      <th className="py-2 pr-4 font-medium">Due today</th>
                      <th className="py-2 pr-4 font-medium">Overdue</th>
                      <th className="py-2 pr-4 font-medium">Completed</th>
                      <th className="py-2 font-medium">On time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.workloads.map((entry) => (
                      <tr key={entry.member.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          {entry.member.name}
                          {entry.member.active ? "" : " · inactive"}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground capitalize">
                          {entry.member.role.replace(/_/g, " ")}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{entry.assigned}</td>
                        <td className="py-2 pr-4 tabular-nums">{entry.dueToday}</td>
                        <td className="py-2 pr-4 tabular-nums">{entry.overdue}</td>
                        <td className="py-2 pr-4 tabular-nums">{entry.completed}</td>
                        <td className="py-2 tabular-nums">{entry.completedOnTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
