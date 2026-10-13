"use client";

import {
  CalendarCheckIcon,
  HeartHandshakeIcon,
  MessageSquareIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
  UsersRoundIcon,
  ClipboardListIcon,
  type LucideIcon,
} from "lucide-react";
import { formatRelativeFromNow } from "@/lib/dates";
import type { ActivityCategory, ActivityEvent } from "@/types/activity";

const ICONS: Record<ActivityCategory, LucideIcon> = {
  visitor: UserPlusIcon,
  follow_up: ClipboardListIcon,
  attendance: CalendarCheckIcon,
  membership: UsersIcon,
  group: UsersRoundIcon,
  communication: MessageSquareIcon,
  care: HeartHandshakeIcon,
  system: SettingsIcon,
};

/**
 * Recent activity.
 *
 * Only general-visibility entries reach this feed — pastoral-care activity
 * is filtered out by the service before it ever gets here.
 */
export function ActivityFeed({
  events,
  now,
  emptyMessage = "Nothing has happened yet.",
}: {
  events: readonly ActivityEvent[];
  now: Date;
  emptyMessage?: string;
}) {
  if (!events.length) {
    return <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const Icon = ICONS[event.category];
        return (
          <li key={event.id} className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{event.summary}</p>
              <p className="text-xs text-muted-foreground">
                {formatRelativeFromNow(event.at, now)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
