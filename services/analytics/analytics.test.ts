import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { attendance, member, session, snapshot, task, visitor } from "@/tests/factories";
import {
  attendanceTrend,
  averageWeeklyAttendance,
  recentAttendanceCount,
  sessionSummary,
  weeksSinceLastAttendance,
} from "./attendance";
import { dashboardSummary } from "./dashboard";
import { journeyFor, journeyReport } from "./journey";

const NOW = new Date("2026-10-12T09:00:00.000Z");

/**
 * Three Sundays of history: 28 Sep, 5 Oct and 12 Oct. The visitor attends
 * the first two, the member attends all three.
 */
function history() {
  const sessions = [
    session({ id: "s1", date: "2026-09-28" }),
    session({ id: "s2", date: "2026-10-05" }),
    session({ id: "s3", date: "2026-10-12" }),
  ];

  return snapshot({
    people: [visitor({ visitor: { ...visitor().visitor!, firstVisitDate: "2026-09-28" } }), member()],
    sessions,
    attendance: [
      attendance({ id: "a1", sessionId: "s1", personId: "person_visitor", firstVisit: true }),
      attendance({ id: "a2", sessionId: "s2", personId: "person_visitor", firstVisit: false }),
      attendance({ id: "a3", sessionId: "s1", personId: "person_member", firstVisit: false }),
      attendance({ id: "a4", sessionId: "s2", personId: "person_member", firstVisit: false }),
      attendance({ id: "a5", sessionId: "s3", personId: "person_member", firstVisit: false }),
    ],
  });
}

describe("attendance aggregation", () => {
  it("counts a session from its own records", () => {
    const summary = sessionSummary(history(), "s1");
    expect(summary).toMatchObject({ total: 2, members: 1, visitors: 1, firstTimeVisitors: 1 });
  });

  it("ignores removed records", () => {
    const data = history();
    const withRemoval = {
      ...data,
      attendance: data.attendance.map((row) =>
        row.id === "a3" ? { ...row, status: "removed" as const } : row,
      ),
    };

    expect(sessionSummary(withRemoval, "s1")?.total).toBe(1);
  });

  it("buckets attendance by week, oldest first", () => {
    const trend = attendanceTrend(history(), NOW, 3);
    expect(trend.map((point) => point.total)).toEqual([2, 2, 1]);
    expect(trend[0].firstTimeVisitors).toBe(1);
    expect(trend.at(-1)?.members).toBe(1);
  });

  it("counts somebody as a member only from their membership date", () => {
    // Joined on 1 Oct: a visitor on 28 Sep, a member on 5 and 12 Oct.
    const data = history();
    const joined = {
      ...data,
      people: data.people.map((person) =>
        person.member ? { ...person, member: { ...person.member, membershipDate: "2026-10-01" } } : person,
      ),
    };

    expect(sessionSummary(joined, "s1")).toMatchObject({ total: 2, members: 0, visitors: 2 });
    expect(sessionSummary(joined, "s2")).toMatchObject({ total: 2, members: 1, visitors: 1 });
    expect(attendanceTrend(joined, NOW, 3).map((point) => point.members)).toEqual([0, 1, 1]);
  });

  it("counts a member who joined on the day of a session as a member at it", () => {
    const data = history();
    const sameDay = {
      ...data,
      people: data.people.map((person) =>
        person.member ? { ...person, member: { ...person.member, membershipDate: "2026-09-28" } } : person,
      ),
    };
    expect(sessionSummary(sameDay, "s1")).toMatchObject({ members: 1, visitors: 1 });
  });

  it("averages only the weeks that actually had a session", () => {
    const average = averageWeeklyAttendance(history(), NOW, 10);
    expect(average.weeksCounted).toBe(3);
    expect(average.average).toBeCloseTo(1.7, 1);
  });

  it("counts the weeks a person attended within the window", () => {
    expect(recentAttendanceCount(history(), "person_member", NOW, 6)).toBe(3);
    expect(recentAttendanceCount(history(), "person_visitor", NOW, 6)).toBe(2);
  });

  it("reports weeks since the last attendance, and nothing when never seen", () => {
    expect(weeksSinceLastAttendance(history(), "person_member", NOW)).toBe(0);
    expect(weeksSinceLastAttendance(history(), "person_visitor", NOW)).toBe(1);
    expect(weeksSinceLastAttendance(history(), "unknown", NOW)).toBeUndefined();
  });
});

describe("journey", () => {
  it("records milestones as dated facts and leaves the rest undated", () => {
    const milestones = journeyFor(history(), "person_visitor");
    const byKey = new Map(milestones.map((milestone) => [milestone.key, milestone]));

    expect(byKey.get("first_visit")?.at).toBe("2026-09-28T12:00:00.000Z");
    expect(byKey.get("second_visit")?.at).toBe("2026-10-05T12:00:00.000Z");
    expect(byKey.get("membership_confirmed")?.at).toBeUndefined();
    expect(byKey.get("group_joined")?.optional).toBe(true);
  });

  it("allows a later milestone without the earlier optional ones", () => {
    const data = history();
    const joined = {
      ...data,
      people: data.people.map((person) =>
        person.id === "person_visitor"
          ? { ...person, groupIds: ["group_connect"] }
          : person,
      ),
      groups: [
        {
          id: "group_connect",
          name: "Riverside Connect Group",
          description: "",
          type: "connect_group" as const,
          members: [
            {
              personId: "person_visitor",
              joinedAt: "2026-10-06T19:00:00.000Z",
              addedBy: TEAM_IDS.admin,
            },
          ],
          active: true,
          involvesMinors: false,
          createdAt: "2026-01-01T09:00:00.000Z",
        },
      ],
    };

    const milestones = journeyFor(joined, "person_visitor");
    const byKey = new Map(milestones.map((milestone) => [milestone.key, milestone]));

    expect(byKey.get("group_joined")?.at).toBe("2026-10-06T19:00:00.000Z");
    expect(byKey.get("orientation_completed")?.at).toBeUndefined();
  });

  it("uses one stated denominator for every conversion rate", () => {
    const data = {
      ...history(),
      tasks: [
        task({
          personId: "person_visitor",
          status: "completed",
          outcome: "contacted",
          completedAt: "2026-09-30T16:00:00.000Z",
        }),
      ],
    };

    const report = journeyReport(data, { from: "2026-09-01", to: "2026-10-12" });

    expect(report.cohortSize).toBe(1);
    expect(report.contacted).toEqual({ numerator: 1, denominator: 1, percentage: 100 });
    expect(report.returned).toEqual({ numerator: 1, denominator: 1, percentage: 100 });
    expect(report.becameMembers).toEqual({ numerator: 0, denominator: 1, percentage: 0 });
  });

  it("reports no percentage rather than zero when the cohort is empty", () => {
    const report = journeyReport(history(), { from: "2020-01-01", to: "2020-12-31" });
    expect(report.cohortSize).toBe(0);
    expect(report.returned.percentage).toBeNull();
  });
});

describe("dashboard metrics", () => {
  it("counts from the records and links each number to its own list", () => {
    const data = {
      ...history(),
      tasks: [
        task({ id: "t_due", dueDate: "2026-10-12" }),
        task({ id: "t_overdue", reference: "FU-0002", dueDate: "2026-10-01" }),
      ],
    };

    const summary = dashboardSummary(data, NOW);
    const byKey = new Map(summary.metrics.map((metric) => [metric.key, metric]));

    expect(byKey.get("members")?.value).toBe(1);
    expect(byKey.get("due_today")?.value).toBe(1);
    expect(byKey.get("overdue")?.value).toBe(1);
    expect(byKey.get("overdue")?.href).toBe("/follow-ups/tasks?due=overdue");
    expect(byKey.get("returning_visitors")?.value).toBe(1);
    expect(byKey.get("awaiting_assignment")?.value).toBe(1);
    expect(byKey.get("average_attendance")?.value).toBe(2);
  });

  it("lists what needs attention, most serious first", () => {
    const data = {
      ...history(),
      tasks: [task({ id: "t_overdue", dueDate: "2026-10-01" })],
    };

    const summary = dashboardSummary(data, NOW);
    expect(summary.attention[0].tone).toBe("critical");
    expect(summary.attention[0].title).toContain("overdue");
  });

  it("keeps restricted activity out of the feed", () => {
    const data = {
      ...history(),
      activity: [
        {
          id: "act_general",
          type: "visitor.registered" as const,
          category: "visitor" as const,
          summary: "A visitor registered.",
          at: "2026-10-11T12:00:00.000Z",
          visibility: "general" as const,
        },
        {
          id: "act_restricted",
          type: "care.created" as const,
          category: "care" as const,
          summary: "Pastoral-care record opened.",
          at: "2026-10-11T13:00:00.000Z",
          visibility: "restricted" as const,
        },
      ],
    };

    const summary = dashboardSummary(data, NOW);
    expect(summary.recentActivity.map((event) => event.id)).toEqual(["act_general"]);
  });
});
