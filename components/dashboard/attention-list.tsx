"use client";

import Link from "next/link";
import { AlertCircleIcon, CheckCircle2Icon, ChevronRightIcon, InfoIcon } from "lucide-react";
import { cn } from "cn";
import type { AttentionItem } from "@/services/analytics/dashboard";

const TONE: Record<AttentionItem["tone"], { icon: typeof InfoIcon; className: string }> = {
  critical: { icon: AlertCircleIcon, className: "text-destructive" },
  warning: { icon: AlertCircleIcon, className: "text-amber-600 dark:text-amber-500" },
  default: { icon: InfoIcon, className: "text-muted-foreground" },
};

/**
 * The short list of things that need a decision today.
 *
 * Kept deliberately short and sorted by seriousness: a volunteer working
 * through a busy Sunday should not be met with a wall of alerts.
 */
export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  if (!items.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
        Nothing needs attention right now.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border">
      {items.map((item) => {
        const tone = TONE[item.tone];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-start gap-3 p-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <tone.icon className={cn("mt-0.5 size-4 shrink-0", tone.className)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
              <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
