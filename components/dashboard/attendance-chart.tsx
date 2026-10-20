"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AttendanceTrendPoint } from "@/types/attendance";

const CONFIG = {
  members: { label: "Members", color: "var(--chart-2)" },
  visitors: { label: "Visitors", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Weekly attendance, counted from the stored attendance records. Weeks with
 * no recorded session show as zero and are called out in the caption rather
 * than hidden.
 */
export function AttendanceChart({
  data,
  className,
}: {
  data: readonly AttendanceTrendPoint[];
  className?: string;
}) {
  return (
    <ChartContainer config={CONFIG} className={className}>
      <AreaChart data={[...data]} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          width={28}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickMargin={4}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          dataKey="members"
          stackId="attendance"
          type="monotone"
          fill="var(--color-members)"
          fillOpacity={0.25}
          stroke="var(--color-members)"
        />
        <Area
          dataKey="visitors"
          stackId="attendance"
          type="monotone"
          fill="var(--color-visitors)"
          fillOpacity={0.3}
          stroke="var(--color-visitors)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
