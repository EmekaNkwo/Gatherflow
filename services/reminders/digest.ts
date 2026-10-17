import type { IsoDate, TeamMemberId } from "@/types/common";
import type { ChurchSnapshot } from "@/types/snapshot";
import { isDueToday, isOverdue, openTasks } from "@/services/follow-ups/selectors";

/**
 * The daily reminder: how much follow-up is waiting for a person.
 *
 * Counts only. A push message travels through the browser vendor's push
 * service, so it carries nothing about anybody in the church — no names, no
 * task types — just enough to make the person open the application, where
 * the details are behind their sign-in.
 */
export interface ReminderCounts {
  dueToday: number;
  overdue: number;
}

export interface ChurchReminder extends ReminderCounts {
  churchName: string;
}

export interface ReminderMessage {
  title: string;
  body: string;
  url: string;
}

export function reminderCounts(snapshot: ChurchSnapshot, teamMemberId: TeamMemberId, today: IsoDate): ReminderCounts {
  const mine = openTasks(snapshot).filter((task) => task.assigneeId === teamMemberId);
  return {
    dueToday: mine.filter((task) => isDueToday(task, today)).length,
    overdue: mine.filter((task) => isOverdue(task, today)).length,
  };
}

function describe({ dueToday, overdue }: ReminderCounts): string {
  const parts = [
    dueToday ? `${dueToday} follow-up${dueToday === 1 ? "" : "s"} due today` : null,
    overdue ? `${overdue} overdue` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(", ");
}

/** The message for one person across their churches, or nothing to send. */
export function composeReminder(churches: readonly ChurchReminder[]): ReminderMessage | null {
  const waiting = churches.filter((entry) => entry.dueToday + entry.overdue > 0);
  if (waiting.length === 0) return null;

  const body =
    churches.length === 1
      ? `${describe(waiting[0])}.`
      : waiting.map((entry) => `${entry.churchName}: ${describe(entry)}.`).join(" ");
  return { title: "GatherFlow reminders", body, url: "/follow-ups/my-tasks" };
}
