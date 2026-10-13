"use client";

import Link from "next/link";
import { cn } from "cn";

interface FunnelStage {
  stageId: string;
  name: string;
  count: number;
}

/**
 * Where visitors currently are in the pipeline.
 *
 * This is a snapshot of live records, not a conversion funnel: nobody is
 * "lost" because they are still at an early stage.
 */
export function VisitorFunnel({ stages }: { stages: readonly FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.count));

  return (
    <ol className="space-y-2">
      {stages.map((stage) => (
        <li key={stage.stageId}>
          <Link
            href={`/follow-ups?stage=${stage.stageId}`}
            className="group block rounded-lg p-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{stage.name}</span>
              <span className="font-semibold tabular-nums">{stage.count}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary/70 transition-all group-hover:bg-primary",
                )}
                style={{ width: `${Math.round((stage.count / max) * 100)}%` }}
              />
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
