import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "cn";
import { formatRatio } from "@/lib/metrics";
import type { Ratio } from "@/types/common";
import type { DashboardMetric } from "@/services/analytics/dashboard";

const TONE_STYLES: Record<NonNullable<DashboardMetric["tone"]>, string> = {
  default: "",
  warning: "border-amber-500/40 dark:border-amber-500/30",
  critical: "border-destructive/50",
};

/**
 * A dashboard number that always explains itself and links to the list it
 * was counted from, so a figure and its underlying records cannot disagree.
 */
export function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <Card className={cn("transition-colors hover:bg-muted/40", TONE_STYLES[metric.tone ?? "default"])}>
      <CardContent className="p-0">
        <Link
          href={metric.href}
          className="flex h-full flex-col gap-1 rounded-xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
            <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
          <span className="text-3xl font-semibold tabular-nums">{metric.value}</span>
          <span className="text-xs text-muted-foreground">{metric.detail}</span>
        </Link>
      </CardContent>
    </Card>
  );
}

interface RatioStatProps {
  label: string;
  ratio: Ratio;
  /** How the figure was calculated — always shown, never implied. */
  explanation?: string;
  className?: string;
}

/**
 * A rate shown with its counts. When there is nothing to measure it says so
 * instead of displaying a misleading 0%.
 */
export function RatioStat({ label, ratio, explanation, className }: RatioStatProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">
        {ratio.percentage === null ? "—" : `${ratio.percentage}%`}
      </p>
      <p className="text-xs text-muted-foreground">{formatRatio(ratio)}</p>
      {explanation ? <p className="text-xs text-muted-foreground">{explanation}</p> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string | number;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
