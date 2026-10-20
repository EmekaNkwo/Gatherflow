"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { AttendanceChart } from "@/components/dashboard/attendance-chart";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { RestrictedState } from "@/components/shared/empty-state";
import { addDaysIso, formatDisplayDate, toIsoDate } from "@/lib/dates";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType } from "@/types/attendance";
import { DEMO_ROLE_LABELS } from "@/types/team";
import type { Ratio } from "@/types/common";
import { customRangeProblem } from "@/services/analytics/report-range";
import { useChurchAnalytics } from "@/hooks/useChurchAnalytics";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useIsMobile } from "@/hooks/use-mobile";

const VISITOR_CHART = {
  count: { label: "First-time visitors", color: "var(--chart-1)" },
} satisfies ChartConfig;

const PERIODS = [
  { id: "30", label: "Last month", days: 30 },
  { id: "90", label: "3 months", days: 90 },
  { id: "365", label: "A year", days: 365 },
  { id: "custom", label: "Choose dates", days: 0 },
] as const;

const SERVICE_OPTIONS: SelectOption[] = [
  { value: "", label: "All services" },
  ...SERVICE_TYPES.map((type) => ({ value: type, label: SERVICE_TYPE_LABELS[type] })),
];

type PeriodId = (typeof PERIODS)[number]["id"];

/** "18 of 30 (60%)", or a plain "none yet" when there is nothing to count. */
function counted(value: Ratio): string {
  if (value.percentage === null) return "none yet";
  return `${value.numerator} of ${value.denominator} (${value.percentage}%)`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Reports: a few plain sentences first, then the charts and the detail.
 *
 * Every rate carries the counts it came from and the window it covers, and
 * the criteria behind any judgement are printed next to the figures.
 */
export default function ReportsPage() {
  const now = useNow();
  const today = toIsoDate(now);
  const { can } = useRole();
  const isMobile = useIsMobile();

  const [period, setPeriod] = useState<PeriodId>("90");
  // The range the report uses, and what is typed into the custom date boxes.
  // A half-typed or back-to-front range stays in the boxes with a note, and
  // the report keeps showing the last range that made sense.
  const [from, setFrom] = useState(() => addDaysIso(today, -90));
  const [to, setTo] = useState(() => today);
  const [draft, setDraft] = useState<{ from: string; to: string }>(() => ({
    from: addDaysIso(today, -90),
    to: today,
  }));
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

  const choosePeriod = (id: PeriodId) => {
    setPeriod(id);
    const preset = PERIODS.find((entry) => entry.id === id);
    if (preset && preset.days > 0) {
      setFrom(addDaysIso(today, -preset.days));
      setTo(today);
      setDraft({ from: addDaysIso(today, -preset.days), to: today });
    }
  };

  const rangeProblem = customRangeProblem(draft.from, draft.to);
  const chooseDates = (next: { from: string; to: string }) => {
    setDraft(next);
    if (!customRangeProblem(next.from, next.to)) {
      setFrom(next.from);
      setTo(next.to);
    }
  };

  const journey = analytics.journey;
  const findings = buildFindings(analytics);
  const fromText = formatDisplayDate(journey.range.from);
  const toText = formatDisplayDate(journey.range.to);
  const rangeText = `${fromText} to ${toText}`;

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PageHeader
        title="Reports"
        description="How things are going, counted fresh from your records each time you open this page."
      />

      <div className="space-y-3">
        <div role="group" aria-label="Period" className="inline-flex flex-wrap rounded-3xl bg-muted p-1">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={period === option.id}
              onClick={() => choosePeriod(option.id)}
              className={cn(
                "min-h-11 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
                period === option.id && "bg-card text-foreground shadow-sm",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-44" data-invalid={rangeProblem ? true : undefined}>
                <FieldLabel htmlFor="report-from">From</FieldLabel>
                <Input
                  id="report-from"
                  type="date"
                  className="h-11"
                  value={draft.from}
                  max={draft.to || undefined}
                  aria-invalid={rangeProblem ? true : undefined}
                  aria-describedby={rangeProblem ? "report-range-problem" : undefined}
                  onChange={(event) => chooseDates({ ...draft, from: event.target.value })}
                />
              </Field>
              <Field className="w-44" data-invalid={rangeProblem ? true : undefined}>
                <FieldLabel htmlFor="report-to">To</FieldLabel>
                <Input
                  id="report-to"
                  type="date"
                  className="h-11"
                  value={draft.to}
                  min={draft.from || undefined}
                  aria-invalid={rangeProblem ? true : undefined}
                  aria-describedby={rangeProblem ? "report-range-problem" : undefined}
                  onChange={(event) => chooseDates({ ...draft, to: event.target.value })}
                />
              </Field>
            </div>
            {rangeProblem ? (
              <p id="report-range-problem" role="alert" className="text-sm text-destructive">
                {rangeProblem} Still showing {rangeText}.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="rounded-[2rem] bg-warm px-6 py-7 md:px-10">
        <p className="text-sm font-medium text-muted-foreground">{rangeText}</p>
        <ul className="mt-3 space-y-3 text-lg">
          {findings.map((finding) => (
            <li key={finding} className="max-w-2xl">
              {finding}
            </li>
          ))}
        </ul>
      </section>

      <Section
        title="Weekly attendance"
        description="The last 12 completed weeks, counting different people each week. A week with no service shows as zero."
        actions={
          <SelectField
            id="report-service"
            aria-label="Which services"
            className="w-auto"
            value={serviceType}
            onValueChange={(value) => setServiceType(value as ServiceType | "")}
            options={SERVICE_OPTIONS}
          />
        }
      >
        <div className="rounded-3xl border bg-card p-5">
          <AttendanceChart data={analytics.attendanceTrend} className="h-60 w-full" />
        </div>
      </Section>

      <Section title="First-time visitors by month" description="Counted on each person's own first visit.">
        <div className="rounded-3xl border bg-card p-5">
          <ChartContainer config={VISITOR_CHART} className="h-56 w-full">
            <BarChart data={analytics.visitorTrend}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={6} />
            </BarChart>
          </ChartContainer>
        </div>
      </Section>

      <Section
        title="From first visit to belonging"
        description={`Out of the ${plural(journey.cohortSize, "person", "people")} whose first visit was between ${fromText} and ${toText}.`}
      >
        <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
          {[
            { label: "Heard from someone", value: journey.contacted },
            { label: "Came back", value: journey.returned },
            { label: "Asked about membership", value: journey.requestedOrientation },
            { label: "Became members", value: journey.becameMembers },
            { label: "Joined a group", value: journey.joinedGroup },
          ].map((row) => (
            <li key={row.label} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
              <span>{row.label}</span>
              <span className="text-right font-medium tabular-nums">{counted(row.value)}</span>
            </li>
          ))}
        </ul>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {plural(journey.closed, "record is", "records are")} closed: paused, declined, passed on, or
          stopped after the agreed number of tries. A closed record is a respected decision, not a
          failure. These figures describe what the church did, never anybody&apos;s faith.
        </p>
      </Section>

      <Section
        title="Members"
        description={`Anyone with no recorded attendance for ${analytics.criteria.inactiveAfterWeeksAbsent} weeks is flagged for review. Nobody's status changes on its own.`}
      >
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {analytics.membership.map((entry) => (
            <li key={entry.status} className="flex flex-col gap-1 rounded-3xl border bg-card px-5 py-4">
              <span className="font-heading text-3xl font-medium tabular-nums">{entry.count}</span>
              <span className="text-sm text-muted-foreground">{entry.label.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Who is carrying the work"
        description="To share follow-ups fairly. These counts show capacity, never anybody's worth."
      >
        {isMobile ? (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {analytics.workloads.map((entry) => (
              <li key={entry.member.id} className="min-h-14 px-5 py-3">
                <p className="font-medium">
                  {entry.member.name}
                  {entry.member.active ? "" : " · inactive"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {DEMO_ROLE_LABELS[entry.member.role]} · {entry.assigned} open · {entry.dueToday} due today ·{" "}
                  {entry.overdue} overdue · {entry.completed} done ({entry.completedOnTime} on time)
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-3xl border bg-card px-5 py-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Team member</th>
                  <th className="py-3 pr-4 font-medium">Role</th>
                  <th className="py-3 pr-4 text-right font-medium">Open</th>
                  <th className="py-3 pr-4 text-right font-medium">Due today</th>
                  <th className="py-3 pr-4 text-right font-medium">Overdue</th>
                  <th className="py-3 pr-4 text-right font-medium">Done</th>
                  <th className="py-3 text-right font-medium">On time</th>
                </tr>
              </thead>
              <tbody>
                {analytics.workloads.map((entry) => (
                  <tr key={entry.member.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">
                      {entry.member.name}
                      {entry.member.active ? "" : " · inactive"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{DEMO_ROLE_LABELS[entry.member.role]}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{entry.assigned}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{entry.dueToday}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{entry.overdue}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{entry.completed}</td>
                    <td className="py-3 text-right tabular-nums">{entry.completedOnTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </PageShell>
  );
}

/** Three to five plain sentences, each carrying the counts behind it. */
function buildFindings(analytics: ReturnType<typeof useChurchAnalytics>): string[] {
  const { journey, weeklyAverage, followUp, overdueRate, groupParticipation } = analytics;
  const findings: string[] = [];

  if (journey.cohortSize > 0) {
    findings.push(
      `${plural(journey.cohortSize, "person", "people")} visited for the first time, and ${journey.returned.numerator} of them came back (${journey.returned.percentage}%).`,
    );
    findings.push(
      `${journey.contacted.numerator} of the ${journey.cohortSize} heard from someone, and ${journey.becameMembers.numerator} became members.`,
    );
  } else {
    findings.push("Nobody visited for the first time in this period.");
  }

  if (weeklyAverage.weeksCounted > 0) {
    findings.push(
      `About ${plural(Math.round(weeklyAverage.average), "person comes", "people come")} on a usual week, averaged over the last ${plural(weeklyAverage.weeksCounted, "completed week", "completed weeks")} with a service. Somebody at two services in one week counts once.`,
    );
  }

  const followUpParts: string[] = [];
  if (followUp.completed.denominator > 0) {
    followUpParts.push(
      `${followUp.completed.numerator} of ${followUp.completed.denominator} follow-ups that ended in this period were done rather than cancelled, ${followUp.onTime.numerator} of them by their due day.`,
    );
  }
  if (overdueRate.denominator > 0) {
    followUpParts.push(
      `Right now ${overdueRate.numerator} of ${overdueRate.denominator} open follow-ups are past their due day.`,
    );
  }
  if (followUpParts.length) findings.push(followUpParts.join(" "));

  if (groupParticipation.denominator > 0) {
    findings.push(
      `${groupParticipation.numerator} of ${groupParticipation.denominator} members are in an active group (${groupParticipation.percentage}%), not counting archived or transferred members.`,
    );
  }

  return findings;
}
