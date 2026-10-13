"use client";

import Link from "next/link";
import { CalendarClockIcon, CheckIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { describeDueDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import { FOLLOW_UP_TASK_TYPE_LABELS } from "@/types/follow-up";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { OverdueBadge, PriorityBadge } from "@/components/shared/badges";
import { personHref } from "@/components/shared/person-cell";

interface TaskListProps {
  tasks: readonly TaskWithPerson[];
  now: Date;
  emptyMessage: string;
  onComplete?: (task: TaskWithPerson) => void;
  onReschedule?: (task: TaskWithPerson) => void;
  onMessage?: (task: TaskWithPerson) => void;
  limit?: number;
}

/**
 * Compact task list used on the dashboard and profile pages: who, what,
 * when it is due, and the one or two actions that matter.
 */
export function TaskList({
  tasks,
  now,
  emptyMessage,
  onComplete,
  onReschedule,
  onMessage,
  limit,
}: TaskListProps) {
  const visible = limit ? tasks.slice(0, limit) : tasks;

  if (!visible.length) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {visible.map((entry) => (
        <li key={entry.task.id}>
          <Item variant="outline" size="sm">
            <ItemContent>
              <ItemTitle className="flex flex-wrap items-center gap-1.5">
                {entry.person ? (
                  <Link href={personHref(entry.person)} className="hover:underline">
                    {displayName(entry.person)}
                  </Link>
                ) : (
                  "Unknown person"
                )}
                <PriorityBadge priority={entry.task.priority} />
                {entry.overdue ? <OverdueBadge /> : null}
              </ItemTitle>
              <ItemDescription>
                {FOLLOW_UP_TASK_TYPE_LABELS[entry.task.type]} · {entry.task.reference} ·{" "}
                {describeDueDate(entry.task.dueDate, now)}
                {entry.assigneeName ? ` · ${entry.assigneeName}` : " · unassigned"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {onMessage ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onMessage(entry)}
                  aria-label={`Prepare a message for ${entry.task.reference}`}
                >
                  <MessageSquareIcon />
                </Button>
              ) : null}
              {onReschedule ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onReschedule(entry)}
                  aria-label={`Reschedule ${entry.task.reference}`}
                >
                  <CalendarClockIcon />
                </Button>
              ) : null}
              {onComplete ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onComplete(entry)}
                  className="gap-1"
                >
                  <CheckIcon />
                  <span className="hidden sm:inline">Complete</span>
                </Button>
              ) : null}
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  );
}
