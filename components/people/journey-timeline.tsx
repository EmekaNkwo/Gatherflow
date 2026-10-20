"use client";

import { CheckIcon, CircleDashedIcon } from "lucide-react";
import { cn } from "cn";
import { formatDisplayDate } from "@/lib/dates";
import type { JourneyMilestone } from "@/types/activity";

/**
 * The visitor-to-member journey as a dated timeline.
 *
 * Deliberately not a progress bar: milestones are things that happened, not
 * a score, and optional ones never block the ones after them.
 */
export function JourneyTimeline({ milestones }: { milestones: readonly JourneyMilestone[] }) {
  return (
    <ol className="relative ml-2.5 space-y-5 border-l pl-6">
      {milestones.map((milestone) => {
        const reached = Boolean(milestone.at);
        return (
          <li key={milestone.key} className="relative">
            <span
              className={cn(
                "absolute -left-[31px] flex size-5 items-center justify-center rounded-full border bg-background",
                reached ? "border-done bg-done text-done-foreground" : "border-dashed text-muted-foreground",
              )}
            >
              {reached ? (
                <CheckIcon className="size-3" />
              ) : (
                <CircleDashedIcon className="size-3" />
              )}
            </span>
            <div className="space-y-0.5">
              <p
                className={cn(
                  "font-medium",
                  !reached && "text-muted-foreground",
                )}
              >
                {milestone.label}
                {!reached && milestone.optional ? (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    (optional)
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">
                {reached
                  ? `${formatDisplayDate(milestone.at)}${milestone.detail ? ` · ${milestone.detail}` : ""}`
                  : "Not yet"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
