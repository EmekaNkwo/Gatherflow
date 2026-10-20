import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { freezeTime, resetHarness, seedChurch, TODAY } from "@/tests/hooks-harness";
import { useChurchAnalytics, useDashboard } from "./useChurchAnalytics";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const OPEN = ["pending", "in_progress", "rescheduled"];

beforeEach(() => freezeTime());
afterEach(resetHarness);

describe("useChurchAnalytics", () => {
  it("defaults to the last 90 days and a ten-week attendance window", () => {
    seedChurch();
    const { result } = renderHook(() => useChurchAnalytics());

    expect(result.current.range).toEqual({ from: "2026-07-14", to: TODAY });
    expect(result.current.attendanceTrend).toHaveLength(10);
    expect(result.current.visitorTrend.map((point) => point.month)).toEqual([
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    expect(result.current.criteria.inactiveAfterWeeksAbsent).toBeGreaterThan(0);
  });

  it("reports the overdue rate with its numerator and denominator", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useChurchAnalytics());

    const open = snapshot.tasks.filter((task) => OPEN.includes(task.status));
    const overdue = open.filter((task) => task.dueDate < TODAY);
    expect(result.current.overdueRate).toEqual({
      numerator: overdue.length,
      denominator: open.length,
      percentage: Math.round((overdue.length / open.length) * 1000) / 10,
    });
  });

  it("has no overdue percentage when nothing is open", () => {
    const snapshot = seedChurch();
    seedChurch({
      snapshot: {
        ...snapshot,
        tasks: snapshot.tasks.filter((task) => !OPEN.includes(task.status)),
      },
    });
    const { result } = renderHook(() => useChurchAnalytics());

    expect(result.current.overdueRate).toEqual({ numerator: 0, denominator: 0, percentage: null });
  });

  it("honours an explicit range, week count and assignee filter", () => {
    seedChurch();
    const range = { from: "2026-10-01", to: "2026-10-12" };
    const { result } = renderHook(() =>
      useChurchAnalytics({ range, weeks: 3, assigneeId: TEAM_IDS.volunteerAmara }),
    );

    expect(result.current.range).toBe(range);
    expect(result.current.attendanceTrend.length).toBeLessThanOrEqual(3);
    expect(result.current.workloads.map((entry) => entry.member.id)).toEqual([TEAM_IDS.volunteerAmara]);
  });

  it("lists every team member's workload without an assignee filter", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useChurchAnalytics());
    expect(result.current.workloads).toHaveLength(snapshot.team.length);
  });

  it("filters the attendance trend by service type", () => {
    seedChurch();
    const { result: all } = renderHook(() => useChurchAnalytics());
    const { result: midweek } = renderHook(() => useChurchAnalytics({ serviceType: "midweek_service" }));

    const sum = (points: { total: number }[]) => points.reduce((acc, point) => acc + point.total, 0);
    expect(sum(midweek.current.attendanceTrend)).toBeGreaterThan(0);
    expect(sum(midweek.current.attendanceTrend)).toBeLessThan(sum(all.current.attendanceTrend));
  });
});

describe("useDashboard", () => {
  it("summarises the church and the signed-in person's own work", () => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useDashboard());

    expect(result.current.churchName).toBe("Grace Community Church");
    expect(result.current.personal).toMatchObject({ open: 6, dueToday: 2, overdue: 1 });
    expect(result.current.attention.find((item) => item.id === "overdue")?.tone).toBe("critical");
    expect(result.current.recentActivity.length).toBeLessThanOrEqual(12);
  });

  it("has an empty personal summary when the account has no team member", () => {
    seedChurch({ role: "member", teamMemberId: null });
    const { result } = renderHook(() => useDashboard());

    expect(result.current.personal).toEqual({ open: 0, dueToday: 0, overdue: 0, completedThisWeek: 0 });
  });
});
