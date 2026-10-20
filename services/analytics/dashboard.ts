import { format } from "date-fns";
import { formatDisplayDate, toIsoDate, weekStart } from "@/lib/dates";
import type { IsoDate, Ratio } from "@/types/common";
import type { ActivityEvent } from "@/types/activity";
import type { ChurchSnapshot } from "@/types/snapshot";
import {
  completionRate,
  isDueToday,
  isOverdue,
  needsOwner,
  openTasks,
} from "../follow-ups/selectors";
import { averageWeeklyAttendance } from "./attendance";
import { isAwaitingAssignment } from "../visitors/pipeline";
import { visitIndex } from "../attendance/visits";
import { firstVisitedThisMonth, hasNoNextStep } from "../visitors/selectors";
import { isOpen } from "../follow-ups/tasks";

/**
 * Dashboard metrics.
 *
 * Each metric carries the filter that produced it, so clicking a number can
 * open exactly the list it was counted from — the figure and the list can
 * never disagree.
 */
export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  /** Shown under the number, e.g. "counted from attendance records". */
  detail: string;
  href: string;
  tone?: "default" | "warning" | "critical";
}

export interface DashboardSummary {
  metrics: DashboardMetric[];
  visitorFunnel: Array<{ stageId: string; name: string; count: number }>;
  followUp: { completed: Ratio; onTime: Ratio };
  attention: AttentionItem[];
  recentActivity: ActivityEvent[];
}

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "warning" | "critical" | "default";
}

export function dashboardSummary(snapshot: ChurchSnapshot, now: Date): DashboardSummary {
  const today = toIsoDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;

  const members = snapshot.people.filter(
    (person) => person.kind === "member" && person.member?.status !== "archived",
  );
  const newMembersThisMonth = members.filter(
    (person) => (person.member?.membershipDate ?? "") >= monthStart,
  );

  const visitors = snapshot.people.filter((person) => person.visitor);
  // The same predicate as the list the tile opens.
  const firstTimeThisMonth = visitors.filter((person) => firstVisitedThisMonth(snapshot, person, today));

  // One definition of a visit (services/attendance/visits.ts), up to today.
  const visitsOf = visitIndex(snapshot, { until: today });
  const returningVisitors = visitors.filter(
    (person) => !person.member && visitsOf(person).count > 1,
  );

  const awaitingAssignment = visitors.filter((person) => isAwaitingAssignment(snapshot.settings, person));

  const open = openTasks(snapshot);
  const dueToday = open.filter((task) => isDueToday(task, today));
  const overdue = open.filter((task) => isOverdue(task, today));
  const weekly = averageWeeklyAttendance(snapshot, now);

  const metrics: DashboardMetric[] = [
    {
      key: "members",
      label: "Members",
      value: members.length,
      detail: "Active, new and inactive members (archived excluded)",
      href: "/members",
    },
    {
      key: "first_time_visitors",
      label: "First-time visitors this month",
      value: firstTimeThisMonth.length,
      detail: `First visit on or after ${formatDisplayDate(monthStart)}`,
      href: "/visitors?filter=first_time_this_month",
    },
    {
      key: "returning_visitors",
      label: "Returning visitors",
      value: returningVisitors.length,
      detail: "More than one visit, not yet members",
      href: "/visitors?filter=returning",
    },
    {
      key: "due_today",
      label: "Follow-ups due today",
      value: dueToday.length,
      detail: `Open tasks due ${formatDisplayDate(today)}`,
      href: "/follow-ups/tasks?due=today",
      tone: dueToday.length ? "warning" : "default",
    },
    {
      key: "overdue",
      label: "Overdue follow-ups",
      value: overdue.length,
      detail: "Open tasks past their due date",
      href: "/follow-ups/tasks?due=overdue",
      tone: overdue.length ? "critical" : "default",
    },
    {
      key: "awaiting_assignment",
      label: "Visitors awaiting assignment",
      value: awaitingAssignment.length,
      detail: "No follow-up person has been assigned yet",
      href: "/visitors?filter=awaiting_assignment",
      tone: awaitingAssignment.length ? "warning" : "default",
    },
    {
      key: "new_members",
      label: "New members this month",
      value: newMembersThisMonth.length,
      detail: `Membership date on or after ${formatDisplayDate(monthStart)}`,
      href: "/members?filter=new",
    },
    {
      key: "average_attendance",
      label: "Average weekly attendance",
      value: Math.round(weekly.average),
      detail: `Different people a week, over ${weekly.weeksCounted} completed week${weekly.weeksCounted === 1 ? "" : "s"}`,
      href: "/attendance",
    },
  ];

  const stages = [...snapshot.settings.pipelineStages].sort((a, b) => a.order - b.order);
  const visitorFunnel = stages.map((stage) => ({
    stageId: stage.id,
    name: stage.name,
    count: visitors.filter((person) => person.visitor?.stageId === stage.id && !person.member)
      .length,
  }));

  return {
    metrics,
    visitorFunnel,
    followUp: completionRate(snapshot),
    attention: attentionItems(snapshot, now),
    recentActivity: recentActivity(snapshot, 12),
  };
}

/** The short list of things a coordinator should look at right now. */
export function attentionItems(snapshot: ChurchSnapshot, now: Date): AttentionItem[] {
  const today = toIsoDate(now);
  const items: AttentionItem[] = [];

  const overdue = openTasks(snapshot).filter((task) => isOverdue(task, today));
  if (overdue.length) {
    items.push({
      id: "overdue",
      title: `${overdue.length} overdue follow-up${overdue.length === 1 ? "" : "s"}`,
      detail: "These are past their due date and need rescheduling or completing.",
      href: "/follow-ups/tasks?due=overdue",
      tone: "critical",
    });
  }

  // Work left with somebody now inactive is as ownerless as unassigned work.
  const unassigned = openTasks(snapshot).filter((task) => needsOwner(task, snapshot));
  if (unassigned.length) {
    const withInactive = unassigned.filter((task) => task.assigneeId).length;
    items.push({
      id: "unassigned_tasks",
      title: `${unassigned.length} task${unassigned.length === 1 ? "" : "s"} with no owner`,
      detail: withInactive
        ? `${withInactive} of them ${withInactive === 1 ? "is" : "are"} with somebody no longer active. Every follow-up should have somebody responsible for it.`
        : "Every follow-up should have somebody responsible for it.",
      href: "/follow-ups/tasks?assignee=unassigned",
      tone: "warning",
    });
  }

  const awaiting = snapshot.people.filter((person) => isAwaitingAssignment(snapshot.settings, person));
  if (awaiting.length) {
    items.push({
      id: "awaiting_assignment",
      title: `${awaiting.length} visitor${awaiting.length === 1 ? "" : "s"} awaiting assignment`,
      detail: "Assign a volunteer so somebody is responsible for the welcome.",
      href: "/visitors?filter=awaiting_assignment",
      tone: "warning",
    });
  }

  const stalled = snapshot.people.filter((person) =>
    hasNoNextStep(
      snapshot.settings,
      person,
      snapshot.tasks.filter((task) => task.personId === person.id && isOpen(task)).length,
    ),
  );
  if (stalled.length) {
    items.push({
      id: "no_next_step",
      title: `${stalled.length} visitor${stalled.length === 1 ? " has" : "s have"} no next step`,
      detail: "Nothing is planned for them. Add a follow-up, or stop following up.",
      href: "/visitors?filter=no_next_step",
      tone: "warning",
    });
  }

  const requested = snapshot.people.filter((person) => person.member?.requestedContact);
  if (requested.length) {
    items.push({
      id: "requested_contact",
      title: `${requested.length} member${requested.length === 1 ? "" : "s"} asked to be contacted`,
      detail: "They have asked somebody to get in touch.",
      href: "/members?filter=requested_contact",
      tone: "warning",
    });
  }

  const notSeen = snapshot.people.filter((person) => {
    if (person.kind !== "member" || person.member?.status !== "active") return false;
    const dates = snapshot.attendance
      .filter((row) => row.personId === person.id && row.status === "present")
      .map((row) => snapshot.sessions.find((session) => session.id === row.sessionId)?.date ?? "")
      .sort();
    const last = dates.at(-1);
    if (!last) return false;
    const weeks = Math.floor(
      (new Date(today).getTime() - new Date(last).getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    return weeks >= snapshot.settings.engagement.inactiveAfterWeeksAbsent;
  });
  if (notSeen.length) {
    items.push({
      id: "not_seen",
      title: `${notSeen.length} active member${notSeen.length === 1 ? "" : "s"} not seen for ${snapshot.settings.engagement.inactiveAfterWeeksAbsent}+ weeks`,
      detail: "Shown for review only — no status is changed automatically.",
      href: "/reports?view=engagement",
      tone: "default",
    });
  }

  return items;
}

/** General-visibility activity only: restricted entries never appear here. */
export function recentActivity(snapshot: ChurchSnapshot, limit = 20): ActivityEvent[] {
  return snapshot.activity
    .filter((event) => event.visibility === "general")
    .slice(0, limit);
}

/** Counts used by the "my work" summary for the signed-in person. */
export function personalSummary(
  snapshot: ChurchSnapshot,
  teamMemberId: string,
  now: Date,
): { dueToday: number; overdue: number; open: number; completedThisWeek: number } {
  const today = toIsoDate(now);
  const week = weekStart(now);
  const mine = snapshot.tasks.filter((task) => task.assigneeId === teamMemberId);

  return {
    open: mine.filter((task) => ["pending", "in_progress", "rescheduled"].includes(task.status))
      .length,
    dueToday: mine.filter((task) => isDueToday(task, today)).length,
    overdue: mine.filter((task) => isOverdue(task, today)).length,
    completedThisWeek: mine.filter(
      (task) =>
        task.status === "completed" &&
        task.completedAt &&
        weekStart(task.completedAt) === week,
    ).length,
  };
}

/** Monthly first-time visitor counts, oldest first. */
export function firstTimeVisitorTrend(
  snapshot: ChurchSnapshot,
  months = 6,
  now: Date = new Date(),
): Array<{ month: IsoDate; label: string; count: number }> {
  const buckets: Array<{ month: IsoDate; label: string; count: number }> = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
    buckets.push({
      month,
      // date-fns rather than the runtime's locale data, which differs between
      // Node versions ("Sep" in one, "Sept" in another).
      label: format(date, "MMM"),
      count: 0,
    });
  }

  // The earliest visit we know of, and never somebody who had been before.
  const visitsOf = visitIndex(snapshot, { until: toIsoDate(now) });
  for (const person of snapshot.people) {
    if (!person.visitor || person.visitor.returningVisitor) continue;
    const first = visitsOf(person).firstVisitDate;
    if (!first) continue;
    const month = `${first.slice(0, 7)}-01`;
    const bucket = buckets.find((entry) => entry.month === month);
    if (bucket) bucket.count += 1;
  }

  return buckets;
}
