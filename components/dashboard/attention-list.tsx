"use client";

import Link from "next/link";
import { AlertCircleIcon, CheckCircle2Icon, ChevronRightIcon, InfoIcon } from "lucide-react";
import { cn } from "cn";
import type { AttentionItem } from "@/services/analytics/dashboard";

const TONE: Record<AttentionItem["tone"], { icon: typeof InfoIcon; className: string }> = {
  critical: { icon: AlertCircleIcon, className: "text-destructive" },
  warning: { icon: AlertCircleIcon, className: "text-primary" },
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
      <div className="flex items-center gap-2 rounded-2xl bg-muted px-5 py-4 text-muted-foreground">
        <CheckCircle2Icon className="size-5 text-done" />
        Nothing needs attention right now.
      </div>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
      {items.map((item) => {
        const tone = TONE[item.tone];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex min-h-16 items-center gap-3 px-5 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <tone.icon className={cn("size-5 shrink-0", tone.className)} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
              </div>
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
