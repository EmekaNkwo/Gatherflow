"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { addDaysIso, toIsoDate } from "@/lib/dates";
import type { IsoDate } from "@/types/common";
import { isDueToday, isOverdue, openTasks } from "@/services/follow-ups/selectors";
import { useSessionStore } from "@/stores/session-store";
import { useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

export interface AgendaEntry {
  id: string;
  date: IsoDate;
  kind: "task" | "service" | "group" | "care";
  title: string;
  detail: string;
  href: string;
  overdue: boolean;
}

/**
 * Reminders.
 *
 * The reminder list always works from the stored records, so the dashboard
 * shows what is due whether or not browser notifications were ever allowed.
 * A browser notification is only ever raised after the user explicitly asks
 * for it. Reminders that arrive with the tab closed are Web Push, handled by
 * `usePushReminders` and the daily run on the server.
 */
export function useNotifications() {
  const snapshot = useSnapshot();
  const now = useNow();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  // Read once on mount. Permission is asked for when daily reminders are
  // turned on (see `usePushReminders`); this only decides whether the bell
  // may raise a notification while the tab is open.
  const [permission] = useState<NotificationPermissionState>(() =>
    typeof window === "undefined" || !("Notification" in window)
      ? "unsupported"
      : (Notification.permission as NotificationPermissionState),
  );

  const today = toIsoDate(now);

  const agenda = useMemo<AgendaEntry[]>(() => {
    const horizon = addDaysIso(today, 14);
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));

    const taskEntries: AgendaEntry[] = openTasks(snapshot)
      .filter((task) => task.dueDate <= horizon)
      .map((task) => {
        const person = peopleById.get(task.personId);
        return {
          id: task.id,
          date: task.dueDate,
          kind: "task" as const,
          title: `${task.reference} · ${task.type.replace(/_/g, " ")}`,
          detail: person ? `${person.firstName} ${person.lastName}` : "Unknown person",
          href: `/follow-ups/tasks?task=${task.id}`,
          overdue: isOverdue(task, today),
        };
      });

    const sessionEntries: AgendaEntry[] = snapshot.sessions
      .filter((session) => session.date >= today && session.date <= horizon)
      .map((session) => ({
        id: session.id,
        date: session.date,
        kind: "service" as const,
        title: session.name,
        detail: `Starts ${session.startTime}`,
        href: `/attendance/${session.id}`,
        overdue: false,
      }));

    return [...taskEntries, ...sessionEntries].sort((left, right) =>
      left.date === right.date ? left.title.localeCompare(right.title) : left.date < right.date ? -1 : 1,
    );
  }, [snapshot, today]);

  const mine = useMemo(() => {
    const tasks = openTasks(snapshot).filter((task) => task.assigneeId === teamMemberId);
    return {
      dueToday: tasks.filter((task) => isDueToday(task, today)),
      overdue: tasks.filter((task) => isOverdue(task, today)),
    };
  }, [snapshot, teamMemberId, today]);

  /** Raises a browser notification, but only when permission was granted. */
  const notifyDueToday = useCallback(() => {
    const count = mine.dueToday.length + mine.overdue.length;
    if (!count) {
      toast.info("Nothing is due for you right now.");
      return;
    }
    if (permission === "granted" && typeof window !== "undefined") {
      new Notification("GatherFlow reminders", {
        body: `${mine.dueToday.length} due today, ${mine.overdue.length} overdue.`,
      });
      return;
    }
    toast.info(`${mine.dueToday.length} due today, ${mine.overdue.length} overdue.`);
  }, [mine, permission]);

  return { agenda, mine, permission, notifyDueToday, today };
}
