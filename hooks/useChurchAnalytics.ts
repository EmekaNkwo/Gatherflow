"use client";

import { useMemo } from "react";
import type { DateRange, TeamMemberId } from "@/types/common";
import type { ServiceType } from "@/types/attendance";
import {
  attendanceTrend,
  averageWeeklyAttendance,
} from "@/services/analytics/attendance";
import {
  dashboardSummary,
  firstTimeVisitorTrend,
  personalSummary,
} from "@/services/analytics/dashboard";
import { defaultJourneyRange, journeyReport } from "@/services/analytics/journey";
import { completionRate, volunteerWorkloads } from "@/services/follow-ups/selectors";
import { groupParticipation, membershipBreakdown } from "@/services/members/selectors";
import { useSessionStore } from "@/stores/session-store";
import { useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

export interface AnalyticsFilters {
  range?: DateRange;
  serviceType?: ServiceType;
  assigneeId?: TeamMemberId;
  groupId?: string;
  weeks?: number;
}

/**
 * Reporting figures.
 *
 * Everything is recomputed from the stored records, and every rate carries
 * its numerator and denominator so a percentage is never shown on its own.
 */
export function useChurchAnalytics(filters: AnalyticsFilters = {}) {
  const snapshot = useSnapshot();
  const now = useNow();

  const range = useMemo(() => filters.range ?? defaultJourneyRange(now), [filters.range, now]);

  return useMemo(() => {
    const weeks = filters.weeks ?? 10;
    const trend = attendanceTrend(snapshot, now, weeks, { serviceType: filters.serviceType });

    return {
      range,
      attendanceTrend: trend,
      weeklyAverage: averageWeeklyAttendance(snapshot, now),
      visitorTrend: firstTimeVisitorTrend(snapshot, 6, now),
      journey: journeyReport(snapshot, range),
      followUp: completionRate(snapshot, { from: range.from, to: range.to }),
      overdueRate: (() => {
        const open = snapshot.tasks.filter((task) =>
          ["pending", "in_progress", "rescheduled"].includes(task.status),
        );
        const overdue = open.filter((task) => task.dueDate < now.toISOString().slice(0, 10));
        return {
          numerator: overdue.length,
          denominator: open.length,
          percentage: open.length
            ? Math.round((overdue.length / open.length) * 1000) / 10
            : null,
        };
      })(),
      membership: membershipBreakdown(snapshot),
      groupParticipation: groupParticipation(snapshot),
      workloads: volunteerWorkloads(snapshot, now).filter((entry) =>
        filters.assigneeId ? entry.member.id === filters.assigneeId : true,
      ),
      criteria: snapshot.settings.engagement,
    };
  }, [snapshot, now, range, filters.serviceType, filters.assigneeId, filters.weeks]);
}

/** The dashboard overview: metrics, funnel, attention list and activity. */
export function useDashboard() {
  const snapshot = useSnapshot();
  const now = useNow();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);

  return useMemo(
    () => ({
      ...dashboardSummary(snapshot, now),
      personal: personalSummary(snapshot, teamMemberId ?? "", now),
      churchName: snapshot.settings.churchName,
    }),
    [snapshot, now, teamMemberId],
  );
}
