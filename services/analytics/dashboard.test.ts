import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { attendance, member, NOW, session, snapshot, task, visitor } from "@/tests/factories";
import type { ActivityEvent } from "@/types/activity";
import type { MemberProfile, Person, VisitorProfile } from "@/types/person";
import { selectVisitors } from "../visitors/selectors";
import {
  attentionItems,
  dashboardSummary,
  firstTimeVisitorTrend,
  personalSummary,
  recentActivity,
} from "./dashboard";

const visitorProfile = (overrides: Partial<VisitorProfile>): VisitorProfile => ({
  ...visitor().visitor!,
  ...overrides,
});
const memberProfile = (overrides: Partial<MemberProfile>): MemberProfile => ({
  ...member().member!,
  ...overrides,
});

function v(id: string, profile: Partial<VisitorProfile>, rest: Partial<Person> = {}): Person {
  return visitor({ id, ...rest, visitor: visitorProfile(profile) });
}
function m(id: string, profile: Partial<MemberProfile>, rest: Partial<Person> = {}): Person {
  return member({ id, ...rest, member: memberProfile(profile) });
}

/**
 * - m1: active, joined this month, attends this week
 * - m2: archived (never counted)
 * - m3: inactive, joined long ago
 * - v1: first visit this month, unassigned
 * - v2: assigned, came twice
 * - v3: first visit this month, closed
 * - v4: a visitor who became a member this month, came twice
 * - v5: settled in a group (terminal stage) without an assignee
 */
function church() {
  return snapshot({
    people: [
      m("m1", { membershipDate: "2026-10-05" }),
      m("m2", { status: "archived" }),
      m("m3", { status: "inactive" }),
      v("v1", { firstVisitDate: "2026-10-04" }),
      v("v2", { firstVisitDate: "2026-09-20", assignedTo: TEAM_IDS.volunteerAmara, stageId: "returned" }),
      v("v3", {
        firstVisitDate: "2026-10-11",
        stageId: "closed",
        closure: { reason: "paused", recordedAt: "2026-10-11T12:00:00.000Z" },
      }),
      m("v4", { status: "new_member", membershipDate: "2026-10-10" }, {
        visitor: visitorProfile({ firstVisitDate: "2026-10-02", stageId: "membership_orientation" }),
      }),
      v("v5", { firstVisitDate: "2026-08-15", stageId: "connected" }),
    ],
    sessions: [
      session({ id: "s1", date: "2026-09-20" }),
      session({ id: "s2", date: "2026-10-04" }),
      session({ id: "s3", date: "2026-10-11" }),
    ],
    attendance: [
      attendance({ id: "a1", sessionId: "s1", personId: "v2" }),
      attendance({ id: "a2", sessionId: "s3", personId: "v2", firstVisit: false }),
      attendance({ id: "a3", sessionId: "s2", personId: "v4" }),
      attendance({ id: "a4", sessionId: "s3", personId: "v4", firstVisit: false }),
      attendance({ id: "a5", sessionId: "s3", personId: "m1", firstVisit: false }),
    ],
    tasks: [
      task({ id: "t_today", personId: "v1" }),
      task({ id: "t_overdue", personId: "v2", dueDate: "2026-10-01" }),
      task({ id: "t_done", personId: "v2", status: "completed", dueDate: "2026-10-01", completedAt: "2026-09-30T12:00:00.000Z" }),
    ],
  });
}

describe("dashboardSummary", () => {
  it("counts every metric from the records", () => {
    const summary = dashboardSummary(church(), NOW);
    expect(summary.metrics.map((metric) => [metric.key, metric.value, metric.tone])).toEqual([
      ["members", 3, undefined],
      ["first_time_visitors", 3, undefined],
      ["returning_visitors", 1, undefined],
      ["due_today", 1, "warning"],
      ["overdue", 1, "critical"],
      ["awaiting_assignment", 1, "warning"],
      ["new_members", 2, undefined],
      ["average_attendance", 2, undefined],
    ]);
  });

  it("explains each figure", () => {
    const details = Object.fromEntries(dashboardSummary(church(), NOW).metrics.map((metric) => [metric.key, metric.detail]));
    expect(details.first_time_visitors).toBe("First visit on or after 1 Oct 2026");
    expect(details.due_today).toBe("Open tasks due 12 Oct 2026");
    expect(details.new_members).toBe("Membership date on or after 1 Oct 2026");
    expect(details.average_attendance).toBe("Different people a week, over 3 completed weeks");
  });

  it("builds the funnel in stage order, leaving out people who became members", () => {
    const funnel = dashboardSummary(church(), NOW).visitorFunnel;
    expect(funnel.map((entry) => entry.stageId)).toEqual([
      "new_visitor",
      "contact_pending",
      "contact_attempted",
      "contacted",
      "invited_to_return",
      "returned",
      "membership_orientation",
      "connected",
      "closed",
    ]);
    expect(Object.fromEntries(funnel.map((entry) => [entry.stageId, entry.count]))).toMatchObject({
      new_visitor: 1,
      returned: 1,
      membership_orientation: 0,
      connected: 1,
      closed: 1,
    });
  });

  it("includes completion rates and the attention list", () => {
    const summary = dashboardSummary(church(), NOW);
    expect(summary.followUp).toEqual({
      completed: { numerator: 1, denominator: 1, percentage: 100 },
      onTime: { numerator: 1, denominator: 1, percentage: 100 },
    });
    expect(summary.attention.map((item) => item.title)).toEqual([
      "1 overdue follow-up",
      // v1 only: v5 is settled in ("connected"), so needs nobody assigned —
      // the same 1 the awaiting-assignment figure shows.
      "1 visitor awaiting assignment",
    ]);
  });

  it("shows quiet defaults for an empty church", () => {
    const summary = dashboardSummary(snapshot(), NOW);
    expect(summary.metrics.every((metric) => metric.value === 0)).toBe(true);
    expect(summary.metrics.filter((metric) => metric.tone).every((metric) => metric.tone === "default")).toBe(true);
    expect(summary.metrics.find((metric) => metric.key === "average_attendance")?.detail).toBe("Different people a week, over 0 completed weeks");
    expect(summary.attention).toEqual([]);
    expect(summary.recentActivity).toEqual([]);
  });

  it("uses the singular for a single recorded week", () => {
    const data = snapshot({
      people: [member()],
      sessions: [session({ date: "2026-10-11" })],
      attendance: [attendance({ personId: "person_member" })],
    });
    expect(dashboardSummary(data, NOW).metrics.at(-1)?.detail).toBe("Different people a week, over 1 completed week");
  });

  // The figure, the list its link opens and the "needs a decision" item all
  // use one rule: somebody already settled in needs nobody assigned.
  it("counts awaiting assignment exactly as the list it links to and the attention item", () => {
    const data = snapshot({
      people: [v("v_new", {}), v("v_settled", { stageId: "connected" })],
    });
    const summary = dashboardSummary(data, NOW);
    const metric = summary.metrics.find((entry) => entry.key === "awaiting_assignment")!;
    const list = selectVisitors(data, { filter: "awaiting_assignment" }, NOW);
    const item = attentionItems(data, NOW).find((entry) => entry.id === "awaiting_assignment");

    expect(list.map((row) => row.person.id)).toEqual(["v_new"]);
    expect(metric.value).toBe(1);
    expect(item?.title).toBe("1 visitor awaiting assignment");
  });
});

describe("audit fixes: tiles that match their lists, and owners", () => {
  it("counts first-time visitors this month exactly as the list the tile opens", () => {
    const data = church();
    const metric = dashboardSummary(data, NOW).metrics.find((entry) => entry.key === "first_time_visitors")!;
    expect(metric.href).toBe("/visitors?filter=first_time_this_month");
    const list = selectVisitors(data, { filter: "first_time_this_month" }, NOW);
    expect(list).toHaveLength(metric.value);
  });

  it("counts open work held by an inactive helper as having no owner", () => {
    const data = snapshot({
      people: [v("v_mine", { assignedTo: TEAM_IDS.coordinator, stageId: "contact_pending" })],
      tasks: [task({ personId: "v_mine", dueDate: "2026-10-20", assigneeId: TEAM_IDS.volunteerEsther })],
    });
    const item = attentionItems(data, NOW).find((entry) => entry.id === "unassigned_tasks");
    expect(item?.title).toBe("1 task with no owner");
    expect(item?.detail).toContain("1 of them is with somebody no longer active");
  });

  it("flags a visitor being followed up who has nothing planned", () => {
    const data = snapshot({
      people: [
        v("v_stalled", { assignedTo: TEAM_IDS.coordinator, stageId: "contact_attempted" }),
        v("v_planned", { assignedTo: TEAM_IDS.coordinator, stageId: "contact_attempted" }),
        v("v_stopped", { assignedTo: TEAM_IDS.coordinator, stageId: "closed", closure: { reason: "paused", recordedAt: "2026-10-01T09:00:00.000Z" } }),
      ],
      tasks: [task({ personId: "v_planned", dueDate: "2026-10-20" })],
    });
    const item = attentionItems(data, NOW).find((entry) => entry.id === "no_next_step");
    expect(item).toMatchObject({ title: "1 visitor has no next step", href: "/visitors?filter=no_next_step" });
    expect(selectVisitors(data, { filter: "no_next_step" }, NOW).map((row) => row.person.id)).toEqual(["v_stalled"]);
  });
});

describe("attentionItems", () => {
  it("lists every kind of item, most serious first", () => {
    const data = snapshot({
      people: [
        v("v_new", {}),
        m("m_asked", { requestedContact: true }),
        m("m_lapsed", {}),
        m("m_never_seen", {}),
        m("m_orphan_row", {}),
        m("m_inactive", { status: "inactive" }),
      ],
      sessions: [session({ id: "old", date: "2026-08-09" })],
      attendance: [
        attendance({ id: "a1", sessionId: "old", personId: "m_lapsed" }),
        attendance({ id: "a2", sessionId: "gone", personId: "m_orphan_row" }),
        attendance({ id: "a3", sessionId: "old", personId: "m_inactive" }),
      ],
      tasks: [
        task({ id: "t1", dueDate: "2026-10-01" }),
        task({ id: "t2", dueDate: "2026-10-02", assigneeId: undefined }),
        task({ id: "t3", dueDate: "2026-10-20", assigneeId: undefined }),
      ],
    });

    expect(attentionItems(data, NOW).map((item) => [item.id, item.title, item.tone])).toEqual([
      ["overdue", "2 overdue follow-ups", "critical"],
      ["unassigned_tasks", "2 tasks with no owner", "warning"],
      ["awaiting_assignment", "1 visitor awaiting assignment", "warning"],
      ["requested_contact", "1 member asked to be contacted", "warning"],
      ["not_seen", "1 active member not seen for 8+ weeks", "default"],
    ]);
  });

  it("uses the singular and plural correctly", () => {
    const data = snapshot({
      people: [v("a", {}), v("b", {}), m("c", { requestedContact: true }), m("d", { requestedContact: true })],
      tasks: [task({ assigneeId: undefined })],
    });
    expect(attentionItems(data, NOW).map((item) => item.title)).toEqual([
      "1 task with no owner",
      "2 visitors awaiting assignment",
      "2 members asked to be contacted",
    ]);
  });

  it("stays empty when the threshold has not been reached", () => {
    const data = snapshot({
      people: [m("m_recent", {})],
      // Seven weeks ago: one week short of the eight-week threshold.
      sessions: [session({ id: "recent", date: "2026-08-24" })],
      attendance: [attendance({ sessionId: "recent", personId: "m_recent" })],
    });
    expect(attentionItems(data, NOW)).toEqual([]);
  });
});

describe("recentActivity", () => {
  const event = (id: string, visibility: ActivityEvent["visibility"]): ActivityEvent => ({
    id,
    type: "visitor.registered",
    category: "visitor",
    summary: id,
    at: "2026-10-11T12:00:00.000Z",
    visibility,
  });

  it("keeps general entries in order up to the limit", () => {
    const data = snapshot({
      activity: [event("a", "general"), event("b", "restricted"), event("c", "general"), event("d", "general")],
    });
    expect(recentActivity(data, 2).map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(recentActivity(data).map((entry) => entry.id)).toEqual(["a", "c", "d"]);
  });
});

describe("personalSummary", () => {
  it("counts one person's open, due, overdue and this week's completed work", () => {
    const data = snapshot({
      tasks: [
        task({ id: "t1" }),
        task({ id: "t2", status: "in_progress", dueDate: "2026-10-05" }),
        task({ id: "t3", status: "rescheduled", dueDate: "2026-10-20" }),
        task({ id: "t4", status: "completed", completedAt: "2026-10-12T08:00:00.000Z" }),
        task({ id: "t5", status: "completed", completedAt: "2026-10-09T08:00:00.000Z" }),
        task({ id: "t6", status: "completed" }),
        task({ id: "t7", status: "cancelled" }),
        task({ id: "t8", assigneeId: TEAM_IDS.coordinator, dueDate: "2026-10-01" }),
      ],
    });
    expect(personalSummary(data, TEAM_IDS.volunteerAmara, NOW)).toEqual({
      open: 3,
      dueToday: 1,
      overdue: 1,
      completedThisWeek: 1,
    });
    expect(personalSummary(data, TEAM_IDS.admin, NOW)).toEqual({
      open: 0,
      dueToday: 0,
      overdue: 0,
      completedThisWeek: 0,
    });
  });
});

describe("firstTimeVisitorTrend", () => {
  it("buckets first visits by month, oldest first, ignoring older visits and members", () => {
    const data = snapshot({
      people: [
        v("a", { firstVisitDate: "2026-10-04" }),
        v("b", { firstVisitDate: "2026-10-11" }),
        v("c", { firstVisitDate: "2026-09-20" }),
        v("d", { firstVisitDate: "2026-07-01" }),
        member(),
      ],
    });
    expect(firstTimeVisitorTrend(data, 3, NOW)).toEqual([
      { month: "2026-08-01", label: "Aug", count: 0 },
      { month: "2026-09-01", label: "Sep", count: 1 },
      { month: "2026-10-01", label: "Oct", count: 2 },
    ]);
  });

  it("crosses a year boundary", () => {
    const data = snapshot({ people: [v("a", { firstVisitDate: "2026-12-24" }), v("b", { firstVisitDate: "2027-01-03" })] });
    const trend = firstTimeVisitorTrend(data, 2, new Date(2027, 0, 15, 12));
    expect(trend.map((entry) => [entry.month, entry.count])).toEqual([
      ["2026-12-01", 1],
      ["2027-01-01", 1],
    ]);
  });
});
